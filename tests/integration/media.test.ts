import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startFixture } from '../fixtures/server';
import { MemoryStore } from '../fixtures/memory-store';
import { createJob } from '../../src/application/jobs';
import { defaultSettings, type DownloadJob } from '../../src/domain/model';
import { runHlsDownload } from '../../src/engine/media/runner';
import type { MediaCheckpoint } from '../../src/engine/media/types';
import type { EngineOptions } from '../../src/engine/ports';
import { inspectMp4Init, inspectMoof, mp4Boxes } from '../../src/engine/media/mp4';
import { TransportConverter } from '../../src/engine/media/transmux';
import { encodedSampleProof } from '../fixtures/sample-proof';
let fixture: Awaited<ReturnType<typeof startFixture>>;
beforeAll(async () => {
  fixture = await startFixture();
});
afterAll(async () => {
  await fixture.close();
});
function setup(path = 'vod.m3u8') {
  const store = new MemoryStore(),
    records = new Map<number, MediaCheckpoint>();
  const job = createJob({ url: fixture.url + '/hls/' + path, media: 'hls' }, defaultSettings, true);
  job.state = 'PROBING';
  const options: EngineOptions = {
    job,
    settings: defaultSettings,
    store,
    signal: new AbortController().signal,
    allowLocalForTests: true,
    transportFactory: () => {
      const converter = new TransportConverter();
      return {
        push: async (bytes) => converter.push(bytes),
        finish: async (duration, index) => converter.finish(duration, index),
        close: () => {},
      };
    },
    checkpoint: async () => {},
    progress: () => {},
    mediaCheckpoints: {
      load: async () => [...records.values()],
      clear: async () => {
        records.clear();
      },
      save: async (job, record) => {
        records.set(record.index, structuredClone(record));
      },
    },
  };
  return { job, store, records, options };
}
describe('real HTTP HLS assembly', () => {
  it('requires both members of a compound media checkpoint to fit one whole allowance', async () => {
    const state = setup('split/video.m3u8');
    state.job.media!.audioUrl = fixture.url + '/hls/split/audio.m3u8';
    const sizes = await Promise.all(
      ['video', 'audio'].map(
        async (kind) =>
          (await readFile(new URL(`../fixtures/media/split/${kind}-0.m4s`, import.meta.url)))
            .length,
      ),
    );
    state.options.settings = { ...defaultSettings, trafficLimit: Math.max(...sizes) };
    await expect(runHlsDownload(state.options)).rejects.toThrow(/allowance/);
    expect(state.job.segments).toHaveLength(1);
    expect(state.job.sha256).toBeNull();
  });
  it('detects a changed weak-validator companion without rewriting the retained output', async () => {
    const state = setup('split/video.m3u8');
    state.job.media!.audioUrl = fixture.url + '/hls/split/audio.m3u8';
    const controller = new AbortController(),
      save = state.options.mediaCheckpoints!.save;
    state.options.signal = controller.signal;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      await save(job, record);
      if (record.index === 1) controller.abort();
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    const retained = state.store.data.slice();
    state.records.get(1)!.companion!.etag = null;
    state.options.signal = new AbortController().signal;
    state.options.mediaCheckpoints!.save = save;
    state.job.state = 'PROBING';
    state.options.fetcher = (async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith('audio-0.m4s')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      bytes[bytes.length - 1]! ^= 1;
      return new Response(bytes, { headers: response.headers });
    }) as typeof fetch;
    await expect(runHlsDownload(state.options)).rejects.toThrow(/source part changed/);
    expect(state.job.segments).toHaveLength(2);
    expect(state.store.data).toEqual(retained);
  });
  it('combines separately encrypted video/audio sources with their own durable key fingerprints', async () => {
    const state = setup('split/enc-video.m3u8');
    state.job.media!.audioUrl = fixture.url + '/hls/split/enc-alternate.m3u8';
    await runHlsDownload(state.options);
    const clear = setup('split/video.m3u8');
    clear.job.media!.audioUrl = fixture.url + '/hls/split/alternate.m3u8';
    await runHlsDownload(clear.options);
    expect(state.job.sha256).toBe(clear.job.sha256);
    expect(state.records.get(1)?.companion?.keyHash).toMatch(/^[a-f\d]{64}$/);
  });
  for (const alternate of [false, true])
    it(`joins separate MP4 video and ${alternate ? 'alternate' : 'original'} audio while preserving selected encoded samples`, async () => {
      const state = setup('split/video.m3u8');
      state.job.media!.audioUrl =
        fixture.url + `/hls/split/${alternate ? 'alternate' : 'audio'}.m3u8`;
      await runHlsDownload(state.options);
      const expected = encodedSampleProof(
        await readFile(new URL('../fixtures/media/source.mp4', import.meta.url)),
      );
      if (alternate) expected.audio = [...expected.audio.slice(94), ...expected.audio.slice(0, 94)];
      expect(encodedSampleProof(state.store.data)).toEqual(expected);
      expect(state.job.media?.sourceTrackIds).toEqual({ video: 1, audio: 1 });
      expect(state.job.media?.completed).toBe(8);
      expect(state.job.media?.parts).toBe(8);
      expect(state.job.segments).toHaveLength(8);
      expect(state.records.get(0)?.companion?.url).toContain('init.mp4');
      expect(state.records.get(1)?.companion?.url).toContain('-0.m4s');
      expect(state.store.maxWrite).toBeLessThanOrEqual(262144);
    });
  it('resumes a committed first audio/video pair without replaying either source body', async () => {
    const state = setup('split/video.m3u8');
    state.job.media!.audioUrl = fixture.url + '/hls/split/audio.m3u8';
    const controller = new AbortController(),
      save = state.options.mediaCheckpoints!.save;
    state.options.signal = controller.signal;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      await save(job, record);
      if (record.index === 1) controller.abort();
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    const retained = structuredClone(state.job.segments);
    fixture.reset();
    state.job.state = 'PROBING';
    state.options.signal = new AbortController().signal;
    state.options.mediaCheckpoints!.save = save;
    await runHlsDownload(state.options);
    for (const kind of ['video', 'audio']) {
      expect(
        fixture.stats.methods.filter(
          (item) => item.path === `/hls/split/${kind}-0.m4s` && item.method === 'GET',
        ),
      ).toHaveLength(0);
      expect(
        fixture.stats.methods.filter(
          (item) => item.path === `/hls/split/${kind}-0.m4s` && item.method === 'HEAD',
        ),
      ).toHaveLength(1);
    }
    expect(state.job.segments.slice(0, 2)).toEqual(retained);
    const reference = setup('split/video.m3u8');
    reference.job.media!.audioUrl = state.job.media!.audioUrl;
    await runHlsDownload(reference.options);
    expect(state.job.sha256).toBe(reference.job.sha256);
  });
  it('rolls back combined source ids when an initialization checkpoint fails', async () => {
    const state = setup('split/video.m3u8');
    state.job.media!.audioUrl = fixture.url + '/hls/split/audio.m3u8';
    const save = state.options.mediaCheckpoints!.save;
    state.options.mediaCheckpoints!.save = async () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(state.job.media!.sourceTrackIds).toBeUndefined();
    expect(state.job.segments).toHaveLength(0);
    state.options.mediaCheckpoints!.save = save;
    state.job.state = 'PROBING';
    await runHlsDownload(state.options);
    expect(state.job.state).toBe('ASSEMBLING');
  });
  it('rejects an audio timeline gap before committing the affected pair', async () => {
    const state = setup('split/video.m3u8');
    state.job.media!.audioUrl = fixture.url + '/hls/split/audio.m3u8';
    const track = inspectMp4Init(
      await readFile(new URL('../fixtures/media/split/audio-init.mp4', import.meta.url)),
    )[0]!;
    state.options.fetcher = (async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith('audio-0.m4s')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer()),
        moof = mp4Boxes(bytes)[0]!;
      const entry = inspectMoof(bytes.subarray(0, moof.end), [track])[0]!,
        view = new DataView(bytes.buffer);
      if (entry.timeVersion === 1)
        view.setBigUint64(entry.timePosition, BigInt(entry.base + 48000));
      else view.setUint32(entry.timePosition, entry.base + 48000);
      return new Response(bytes, { headers: response.headers });
    }) as typeof fetch;
    await expect(runHlsDownload(state.options)).rejects.toThrow(/start times/);
    expect(state.job.segments).toHaveLength(1);
    expect(state.job.sha256).toBeNull();
  });
  it('requires the encrypted part and key to fit a full allowance instead of repeating a key-only pause each window', async () => {
    const state = setup('aes-vod.m3u8');
    const init = await readFile(new URL('../fixtures/media/init.mp4', import.meta.url));
    state.options.settings = {
      ...defaultSettings,
      trafficLimit: (Math.floor(init.length / 16) + 1) * 16,
    };
    await expect(runHlsDownload(state.options)).rejects.toThrow(/key verification.*allowance/);
    expect(state.job.segments).toHaveLength(0);
  });
  it('decrypts complete CBC segments addressed by exact and implicit byte ranges', async () => {
    const state = setup('aes-ranged.m3u8');
    await runHlsDownload(state.options);
    const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
    expect(state.job.sha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(state.store.data).toEqual(new Uint8Array(source));
  });
  it('aborts a partial key response without committing output and rejects oversized encrypted payloads', async () => {
    const state = setup('aes-vod.m3u8'),
      controller = new AbortController();
    state.options.signal = controller.signal;
    let canceled = false;
    state.options.fetcher = (async (input, init) => {
      if (!String(input).endsWith('key-a.bin')) return fetch(input, init);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new Uint8Array(8));
            setTimeout(() => controller.abort(), 10);
          },
          cancel() {
            canceled = true;
          },
        }),
      );
    }) as typeof fetch;
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(canceled).toBe(true);
    expect(state.job.segments).toHaveLength(0);
    const large = setup('aes-vod.m3u8');
    large.options.fetcher = (async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith('aes-part-0.m4s')) return response;
      const headers = new Headers(response.headers);
      headers.set('content-length', String(16 * 1024 * 1024 + 32));
      return new Response(response.body, { headers });
    }) as typeof fetch;
    await expect(runHlsDownload(large.options)).rejects.toThrow(/16 MiB/);
    expect(large.job.segments).toHaveLength(1);
    expect(large.job.sha256).toBeNull();
  });
  for (const transport of ['mp4', 'ts'])
    it(`decrypts AES-128 ${transport} with encrypted initialization, rotated keys, explicit/sequence IVs and clear parts`, async () => {
      const state = setup(transport === 'ts' ? 'aes-ts-vod.m3u8' : 'aes-vod.m3u8');
      const payloads: number[] = [];
      state.options.accountPayload = async (bytes) => {
        payloads.push(bytes);
      };
      await runHlsDownload(state.options);
      const reference = setup(transport === 'ts' ? 'ts-vod.m3u8' : 'vod.m3u8');
      await runHlsDownload(reference.options);
      expect(state.job.sha256).toBe(reference.job.sha256);
      expect(state.store.data).toEqual(reference.store.data);
      expect(state.records.get(0)?.keyHash).toMatch(/^[a-f\d]{64}$/);
      expect(state.records.get(transport === 'ts' ? 2 : 3)?.keyHash).toBeUndefined();
      expect(payloads.filter((bytes) => bytes === 16).length).toBeGreaterThanOrEqual(3);
      const cipherBytes = [...state.records.values()].reduce(
        (sum, record) => sum + record.bytes,
        0,
      );
      expect(payloads.reduce((sum, bytes) => sum + bytes, 0)).toBe(
        cipherBytes + 16 * (transport === 'ts' ? 3 : 4),
      );
    });
  it('retains committed output and refuses a changed key on resume before requesting missing media', async () => {
    const state = setup('aes-vod.m3u8'),
      controller = new AbortController(),
      save = state.options.mediaCheckpoints!.save;
    state.options.signal = controller.signal;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      await save(job, record);
      if (record.index === 1) controller.abort();
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    const retained = state.store.data.slice();
    state.options.signal = new AbortController().signal;
    state.options.mediaCheckpoints!.save = save;
    state.job.state = 'PROBING';
    fixture.setVersion('/hls/key-a.bin', 2);
    fixture.reset();
    try {
      await expect(runHlsDownload(state.options)).rejects.toThrow(/key changed/);
      expect(state.store.data).toEqual(retained);
      expect(state.job.segments).toHaveLength(2);
      expect(fixture.stats.paths).not.toContain('/hls/aes-part-1.m4s');
    } finally {
      fixture.setVersion('/hls/key-a.bin', 1);
    }
    state.job.state = 'PROBING';
    await runHlsDownload(state.options);
    const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
    expect(state.store.data).toEqual(new Uint8Array(source));
  });
  it('rejects invalid key lengths and CBC padding without committing the failed logical part', async () => {
    for (const [path, committed, error] of [
      ['aes-bad-key.m3u8', 0, /16 bytes/],
      ['aes-bad-padding.m3u8', 1, /could not be decrypted/],
    ] as const) {
      const state = setup(path);
      await expect(runHlsDownload(state.options)).rejects.toThrow(error);
      expect(state.job.segments).toHaveLength(committed);
      expect(state.records.size).toBe(committed);
      expect(state.job.sha256).toBeNull();
    }
  });
  it('supports encrypted source revalidation without stable validators or key persistence', async () => {
    const state = setup('aes-vod.m3u8'),
      controller = new AbortController(),
      save = state.options.mediaCheckpoints!.save;
    state.options.signal = controller.signal;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      await save(job, { ...record, etag: null });
      if (record.index === 1) controller.abort();
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    state.options.signal = new AbortController().signal;
    state.options.mediaCheckpoints!.save = save;
    state.job.state = 'PROBING';
    await runHlsDownload(state.options);
    const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
    expect(state.store.data).toEqual(new Uint8Array(source));
    for (const record of state.records.values()) expect(Object.keys(record)).not.toContain('key');
  });
  it('converts real HTTP TS parts into a verified MP4 with bounded writes', async () => {
    const state = setup('ts-vod.m3u8');
    await runHlsDownload(state.options);
    expect(state.job.state).toBe('ASSEMBLING');
    expect(state.job.media?.transport).toBe('mpegts');
    expect(state.job.segments).toHaveLength(4);
    expect(state.records.size).toBe(4);
    expect(state.job.sha256).toBe(createHash('sha256').update(state.store.data).digest('hex'));
    expect(state.store.maxWrite).toBeLessThanOrEqual(262144);
    expect(state.job.media?.initializationBytes).toBeGreaterThan(0);
    const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
    expect(encodedSampleProof(state.store.data)).toEqual(encodedSampleProof(source));
  });
  it('resumes converted TS output after a committed part without replaying its source payload', async () => {
    const state = setup('ts-vod.m3u8'),
      controller = new AbortController();
    state.options.signal = controller.signal;
    const save = state.options.mediaCheckpoints!.save;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      await save(job, record);
      if (record.index === 0) controller.abort();
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.job.segments).toHaveLength(1);
    const first = structuredClone(state.job.segments[0]);
    state.job.state = 'PROBING';
    state.options.signal = new AbortController().signal;
    state.options.mediaCheckpoints!.save = save;
    const before = fixture.stats.methods.filter(
      (item) => item.method === 'GET' && item.path === '/hls/part-0.ts',
    ).length;
    await runHlsDownload(state.options);
    const reference = setup('ts-vod.m3u8');
    await runHlsDownload(reference.options);
    expect(state.store.data).toEqual(reference.store.data);
    expect(state.job.segments[0]).toEqual(first);
    expect(
      fixture.stats.methods.filter(
        (item) => item.method === 'GET' && item.path === '/hls/part-0.ts',
      ),
    ).toHaveLength(before + 1);
  });
  it('rolls back transformed TS initialization/timeline when its first durable checkpoint fails', async () => {
    const state = setup('ts-vod.m3u8'),
      save = state.options.mediaCheckpoints!.save;
    state.options.mediaCheckpoints!.save = async () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(state.job.segments).toEqual([]);
    expect(state.records.size).toBe(0);
    expect(state.job.media?.initializationHash).toBeUndefined();
    expect(state.job.media?.originSeconds).toBeUndefined();
    state.options.mediaCheckpoints!.save = save;
    state.job.state = 'PROBING';
    await runHlsDownload(state.options);
    expect(state.job.state).toBe('ASSEMBLING');
    expect(state.job.segments).toHaveLength(4);
  });
  it('unwraps the MPEG-TS 33-bit timestamp clock across independent parts', async () => {
    const state = setup('ts-vod.m3u8');
    state.options.fetcher = (async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith('.ts')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      for (let packet = 0; packet < bytes.length; packet += 188) {
        if (!(bytes[packet + 1]! & 0x40)) continue;
        const id = ((bytes[packet + 1]! & 31) << 8) | bytes[packet + 2]!;
        if (id !== 256 && id !== 257) continue;
        let at = packet + 4;
        if (bytes[packet + 3]! & 0x20) at += 1 + bytes[at]!;
        if (bytes[at] !== 0 || bytes[at + 1] !== 0 || bytes[at + 2] !== 1)
          throw Error('Fixture PES mismatch');
        const shift = (position: number) => {
          const old =
            (bytes[position]! & 14) * 2 ** 29 +
            bytes[position + 1]! * 2 ** 22 +
            (bytes[position + 2]! & 254) * 2 ** 14 +
            bytes[position + 3]! * 2 ** 7 +
            (bytes[position + 4]! >> 1);
          const value = (old + 2 ** 33 - 180000) % 2 ** 33;
          bytes[position] =
            (bytes[position]! & 0xf0) | ((Math.floor(value / 2 ** 30) & 7) << 1) | 1;
          bytes[position + 1] = Math.floor(value / 2 ** 22) & 255;
          bytes[position + 2] = ((Math.floor(value / 2 ** 15) & 127) << 1) | 1;
          bytes[position + 3] = Math.floor(value / 2 ** 7) & 255;
          bytes[position + 4] = ((value & 127) << 1) | 1;
        };
        if (bytes[at + 7]! & 0x80) shift(at + 9);
        if (bytes[at + 7]! & 0x40) shift(at + 14);
      }
      return new Response(bytes, { headers: response.headers });
    }) as typeof fetch;
    await runHlsDownload(state.options);
    expect(state.job.state).toBe('ASSEMBLING');
    expect(state.job.media?.originSeconds).toBeGreaterThan(90000);
    const tracks = inspectMp4Init(
      state.store.data.subarray(0, state.job.media!.initializationBytes!),
    );
    const video = tracks.find((track) => track.kind === 'video')!;
    expect(state.job.media!.trackEnds![video.id]! / video.timescale).toBeCloseTo(4.0832, 3);
  });
  it('assembles a verified MP4 identical to the independently decoded synthetic source', async () => {
    const { job, store, records, options } = setup();
    await runHlsDownload(options);
    const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
    expect(job.state).toBe('ASSEMBLING');
    expect(job.sha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(store.data).toEqual(new Uint8Array(source));
    expect(records.size).toBe(5);
    expect(store.maxWrite).toBeLessThanOrEqual(262144);
  });
  it('assembles explicit initialization and implicit consecutive byte ranges from a shared source', async () => {
    const state = setup('ranged.m3u8');
    await runHlsDownload(state.options);
    const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
    expect(state.job.state).toBe('ASSEMBLING');
    expect(state.store.data).toEqual(new Uint8Array(source));
    expect(state.job.sha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect([...state.records.values()].every((record) => record.fullSize === source.length)).toBe(
      true,
    );
  });
  it('retains only committed logical parts after interruption and resumes without replaying their payload', async () => {
    const state = setup(),
      controller = new AbortController();
    state.options.signal = controller.signal;
    const save = state.options.mediaCheckpoints!.save;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      await save(job, record);
      if (record.index === 1) controller.abort();
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.job.segments).toHaveLength(2);
    const bytes = state.job.downloaded;
    state.job.state = 'PROBING';
    state.options.signal = new AbortController().signal;
    state.options.mediaCheckpoints!.save = save;
    let replayed = 0;
    const fetcher = fetch;
    state.options.fetcher = (async (input, init) => {
      if (String(input).endsWith('/part-0.m4s') && init?.method !== 'HEAD') replayed++;
      return fetcher(input, init);
    }) as typeof fetch;
    await runHlsDownload(state.options);
    expect(replayed).toBe(0);
    expect(state.job.downloaded).toBeGreaterThan(bytes);
    expect(state.job.state).toBe('ASSEMBLING');
  });
  it('does not commit corrupt media or advance the timeline if durable checkpoint persistence fails', async () => {
    const state = setup();
    const save = state.options.mediaCheckpoints!.save;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      if (record.index === 1) throw new DOMException('full', 'QuotaExceededError');
      await save(job, record);
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(state.job.segments).toHaveLength(1);
    expect(state.records.size).toBe(1);
    expect(state.job.media?.trackEnds).toEqual({});
    state.job.state = 'PROBING';
    state.options.mediaCheckpoints!.save = save;
    await runHlsDownload(state.options);
    expect(state.job.state).toBe('ASSEMBLING');
  });
  it('normalizes a nonzero decode-time origin without altering sample payloads or A/V alignment', async () => {
    const state = setup();
    const tracks = inspectMp4Init(
      await readFile(new URL('../fixtures/media/init.mp4', import.meta.url)),
    );
    state.options.fetcher = (async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith('.m4s')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const moof = mp4Boxes(bytes).find((box) => box.type === 'moof')!;
      const fragment = bytes.subarray(moof.start, moof.end),
        view = new DataView(fragment.buffer, fragment.byteOffset, fragment.byteLength);
      for (const entry of inspectMoof(fragment, tracks)) {
        const next = entry.base + tracks.find((track) => track.id === entry.id)!.timescale * 10;
        if (entry.timeVersion === 1) view.setBigUint64(entry.timePosition, BigInt(next));
        else view.setUint32(entry.timePosition, next);
      }
      return new Response(bytes, { status: response.status, headers: response.headers });
    }) as typeof fetch;
    await runHlsDownload(state.options);
    expect(state.job.media?.originSeconds).toBe(10);
    expect(state.store.data).toEqual(
      new Uint8Array(await readFile(new URL('../fixtures/media/source.mp4', import.meta.url))),
    );
  });
  it('retains committed data when the manifest changes, or stored bytes are corrupt', async () => {
    for (const corrupt of [false, true]) {
      const state = setup(),
        controller = new AbortController();
      state.options.signal = controller.signal;
      const save = state.options.mediaCheckpoints!.save;
      state.options.mediaCheckpoints!.save = async (job, record) => {
        await save(job, record);
        if (record.index === 1) controller.abort();
      };
      await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
      state.options.signal = new AbortController().signal;
      state.options.mediaCheckpoints!.save = save;
      state.job.state = 'PROBING';
      if (corrupt) state.store.data[100]! ^= 1;
      else
        state.options.fetcher = (async (input, init) => {
          const response = await fetch(input, init);
          if (!String(input).includes('vod.m3u8')) return response;
          return new Response(
            (await response.text()).replace('#EXT-X-VERSION:7', '#EXT-X-VERSION:8'),
            { headers: response.headers },
          );
        }) as typeof fetch;
      await expect(runHlsDownload(state.options)).rejects.toThrow(
        corrupt ? /checksum|integrity|corrupt/i : /playlist changed/i,
      );
      expect(state.job.segments).toHaveLength(2);
      expect(state.records.size).toBe(2);
    }
  });
  it('rejects sample addresses outside mdat without committing the failed part', async () => {
    const state = setup();
    state.options.fetcher = (async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith('part-0.m4s')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer()),
        view = new DataView(bytes.buffer);
      const moof = mp4Boxes(bytes).find((box) => box.type === 'moof')!;
      const traf = mp4Boxes(bytes, moof.body, moof.end).find((box) => box.type === 'traf')!;
      const trun = mp4Boxes(bytes, traf.body, traf.end).find((box) => box.type === 'trun')!;
      view.setInt32(trun.body + 8, -100);
      return new Response(bytes, { headers: response.headers });
    }) as typeof fetch;
    await expect(runHlsDownload(state.options)).rejects.toThrow(/outside its media payload/);
    expect(state.job.segments).toHaveLength(1);
    expect(state.records.size).toBe(1);
  });
  it('compares weak-validator source bytes before reuse and retains checkpoints when they changed', async () => {
    const state = setup(),
      controller = new AbortController();
    state.options.signal = controller.signal;
    const save = state.options.mediaCheckpoints!.save;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      await save(job, { ...record, etag: 'W/"weak"' });
      if (record.index === 1) controller.abort();
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    const durable = state.store.data.slice(0, state.job.downloaded);
    state.options.signal = new AbortController().signal;
    state.options.mediaCheckpoints!.save = save;
    state.job.state = 'PROBING';
    state.options.fetcher = (async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).endsWith('part-0.m4s')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      bytes[bytes.length - 1]! ^= 1;
      return new Response(bytes, { headers: response.headers });
    }) as typeof fetch;
    await expect(runHlsDownload(state.options)).rejects.toThrow(/source part changed/);
    expect(state.job.segments).toHaveLength(2);
    expect(state.records.size).toBe(2);
    expect(state.store.data).toEqual(durable);
  });
});
