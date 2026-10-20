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
});
