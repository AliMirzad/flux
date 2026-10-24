import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { startFixture } from '../fixtures/server';
import { MemoryStore } from '../fixtures/memory-store';
import { encodedSampleProof } from '../fixtures/sample-proof';
import { createJob } from '../../src/application/jobs';
import { defaultSettings } from '../../src/domain/model';
import { runHlsDownload } from '../../src/engine/media/runner';
import { reviewDash } from '../../src/engine/media/dash-network';
import type { EngineOptions } from '../../src/engine/ports';
import type { MediaCheckpoint } from '../../src/engine/media/types';
let fixture: Awaited<ReturnType<typeof startFixture>>;
beforeAll(async () => {
  fixture = await startFixture();
});
afterAll(async () => {
  await fixture.close();
});
function setup(mode: string, alternate = false) {
  const job = createJob(
    {
      url: fixture.url + '/hls/split/dash-' + mode + '.mpd',
      media: 'dash',
      dash: { videoId: '0/video', audioId: alternate ? '1/alternate' : '1/audio' },
    },
    defaultSettings,
    true,
  );
  job.state = 'PROBING';
  const store = new MemoryStore(),
    records = new Map<number, MediaCheckpoint>();
  const options: EngineOptions = {
    job,
    store,
    settings: defaultSettings,
    signal: new AbortController().signal,
    allowLocalForTests: true,
    checkpoint: async () => {},
    progress: () => {},
    mediaCheckpoints: {
      load: async () => [...records.values()],
      clear: async () => {
        records.clear();
      },
      save: async (_job, record) => {
        records.set(record.index, structuredClone(record));
      },
    },
  };
  return { job, store, records, options };
}
describe('real HTTP DASH assembly', () => {
  it('finishes retained dynamic DASH tracks offline after an interruption', async () => {
    const state = setup('live');
    state.job.url += '?stream=offline&hold=1';
    state.job.media!.recording = { maxSeconds: 30 };
    const abort = new AbortController(),
      save = state.options.mediaCheckpoints!.save;
    state.options.signal = abort.signal;
    state.options.mediaCheckpoints!.save = async (job, record) => {
      await save(job, record);
      if (record.index === 1) abort.abort();
    };
    await expect(runHlsDownload(state.options)).rejects.toMatchObject({ name: 'AbortError' });
    const retained = state.store.data.slice();
    state.job.media!.recording.finished = true;
    state.job.state = 'PROBING';
    state.options.signal = new AbortController().signal;
    state.options.mediaCheckpoints!.save = save;
    state.options.fetcher = (async () => {
      throw new Error('Offline');
    }) as typeof fetch;
    await runHlsDownload(state.options);
    expect(state.job.state).toBe('ASSEMBLING');
    expect(state.store.data).toEqual(retained);
    expect(encodedSampleProof(retained).video).toHaveLength(16);
    expect(encodedSampleProof(retained).audio).toHaveLength(44);
  });
  it('records a dynamic DASH window and final static manifest with both selected tracks', async () => {
    const state = setup('live?stream=integration');
    state.job.url = fixture.url + '/hls/split/dash-live.mpd?stream=integration';
    state.job.media!.recording = { maxSeconds: 30 };
    await runHlsDownload(state.options);
    expect(state.job.media!.recording.finished).toBe(true);
    expect(encodedSampleProof(state.store.data)).toEqual(
      encodedSampleProof(await readFile(new URL('../fixtures/media/source.mp4', import.meta.url))),
    );
  });
  for (const mode of ['number', 'index'])
    it(`normalizes consecutive DASH ${mode} periods into one playable timeline`, async () => {
      const state = setup('multi-' + mode, true);
      await runHlsDownload(state.options);
      const original = encodedSampleProof(
        await readFile(new URL('../fixtures/media/source.mp4', import.meta.url)),
      );
      const audio = [...original.audio.slice(94), ...original.audio.slice(0, 94)];
      expect(encodedSampleProof(state.store.data)).toEqual({
        video: [...original.video, ...original.video],
        audio: [...audio, ...audio],
      });
      expect(state.job.media!.duration).toBeCloseTo(8.1664);
    });
  for (const mode of ['number', 'time', 'list', 'index', 'offset'])
    it(`assembles ${mode} addressing and preserves every selected encoded sample`, async () => {
      const { job, store, options } = setup(mode, true);
      const review = await reviewDash(job.url, options, job.media!.dash);
      expect(review.selection.audioId).toBe('1/alternate');
      expect(review.choices).toHaveLength(3);
      await runHlsDownload(options);
      const expected = encodedSampleProof(
        await readFile(new URL('../fixtures/media/source.mp4', import.meta.url)),
      );
      expected.audio = [...expected.audio.slice(94), ...expected.audio.slice(0, 94)];
      expect(encodedSampleProof(store.data)).toEqual(expected);
      expect(job.sha256).toBe('3009eb4555cb32473be564240fdf9719cfb69c24b43f7387753c3d9397d63a67');
      expect(job.state).toBe('ASSEMBLING');
      expect(store.maxWrite).toBeLessThanOrEqual(262144);
    });
  it('retains both selected sources through interruption and resumes without replaying completed bodies', async () => {
    const state = setup('number'),
      controller = new AbortController(),
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
    expect(state.job.segments.slice(0, 2)).toEqual(retained);
    expect(
      fixture.stats.methods
        .filter((entry) => ['video-0.m4s', 'audio-0.m4s'].some((name) => entry.path.endsWith(name)))
        .map((entry) => entry.method),
    ).toEqual(['HEAD', 'HEAD']);
    expect(state.job.sha256).toBe(
      '33607a3932d6ecdd1c28a2bbdac8f812cb0e854052e2f00e69f8bef5b982cf64',
    );
  });
});
