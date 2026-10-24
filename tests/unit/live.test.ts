import { expect, it } from 'vitest';
import { parseHls } from '../../src/engine/media/hls';
import { appendLive, serializeMediaPlan } from '../../src/engine/media/live';
import { createJob } from '../../src/application/jobs';
const playlist = (sequence: number, names: string[], end = false) => {
  const result = parseHls(
    '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:' +
      sequence +
      '\n#EXT-X-MAP:URI="init.mp4"\n' +
      names.map((name) => '#EXTINF:2,\n' + name).join('\n') +
      (end ? '\n#EXT-X-ENDLIST' : ''),
    'https://media.example.com/live/index.m3u8',
    false,
    true,
  );
  if (result.kind !== 'media') throw new Error('Fixture is not media');
  return result;
};
it('appends moving sequence windows exactly once and marks a finite ending', () => {
  const plan = playlist(100, ['a.m4s', 'b.m4s']);
  appendLive(plan, playlist(101, ['b.m4s', 'c.m4s']));
  appendLive(plan, playlist(101, ['b.m4s', 'c.m4s'], true));
  expect(plan.parts).toHaveLength(3);
  expect(plan.duration).toBe(6);
  expect(plan.live).toBeUndefined();
});
it('rejects gaps, overlap changes, backwards clocks and initialization changes', () => {
  expect(() => appendLive(playlist(0, ['a']), playlist(2, ['c']))).toThrow(/missing segment/);
  expect(() => appendLive(playlist(0, ['a']), playlist(0, ['changed']))).toThrow(
    /changed identity/,
  );
  expect(() => appendLive(playlist(10, ['a', 'b']), playlist(9, ['a']))).toThrow(/backwards/);
  const next = playlist(0, ['a']);
  next.init!.url += '?v=2';
  expect(() => appendLive(playlist(0, ['a']), next)).toThrow(/initialization changed/);
});
it('requires explicit finite recording options and keeps ordinary VOD parsing strict', () => {
  expect(() => parseHls('#EXTM3U\n#EXTINF:2,\na.ts', 'https://example.com/a.m3u8')).toThrow(/live/);
  for (const seconds of [0, -1, 86401, NaN, 1.5])
    expect(() =>
      createJob({ url: 'https://example.com/live.m3u8', media: 'hls', recordingSeconds: seconds }),
    ).toThrow(/recording/);
  expect(
    createJob({ url: 'https://example.com/live.mpd', media: 'dash', recordingSeconds: 10 }).media!
      .recording,
  ).toEqual({ maxSeconds: 10 });
});
it('retains declared discontinuities and new initializations as live windows slide', () => {
  const plan = playlist(100, ['a.m4s', 'b.m4s']);
  const next = playlist(102, ['c.m4s']);
  next.parts[0]!.epoch = 1;
  next.init!.url += '?period=2';
  appendLive(plan, next);
  expect(plan.parts[2]!.presentationOffset).toBe(4);
  expect(plan.parts[2]!.initialization?.url).toContain('?period=2');
  const restored = parseHls(
    serializeMediaPlan(plan),
    'https://media.example.com/live/index.m3u8',
    false,
    true,
  );
  if (restored.kind !== 'media') throw new Error('Not media');
  expect(restored.parts).toEqual(plan.parts);
  const overlap = playlist(102, ['c.m4s', 'd.m4s']);
  overlap.parts.forEach((part) => {
    part.epoch = 1;
  });
  overlap.init!.url += '?period=2';
  appendLive(plan, overlap);
  expect(plan.parts).toHaveLength(4);
  expect(plan.duration).toBe(8);
});
