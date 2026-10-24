import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { combineMp4Init, pairHlsPlans, remapMp4Moof } from '../../src/engine/media/compose';
import { inspectMp4Init, inspectMoof, mp4Boxes } from '../../src/engine/media/mp4';
import { parseHls } from '../../src/engine/media/hls';
import { encodedSampleProof } from '../fixtures/sample-proof';

const read = (name: string) =>
  readFile(new URL('../fixtures/media/split/' + name, import.meta.url));
const video = await read('video-init.mp4'),
  audio = await read('audio-init.mp4');
it('combines colliding source track ids without changing input codec metadata or encoded samples', async () => {
  const before = Buffer.from(audio),
    combined = combineMp4Init(video, audio);
  expect(combined.sourceIds).toEqual({ video: 1, audio: 1 });
  const tracks = inspectMp4Init(combined.initialization);
  expect(tracks.map((track) => [track.id, track.kind, track.timescale])).toEqual([
    [1, 'video', 30000],
    [2, 'audio', 48000],
  ]);
  const pieces: Uint8Array[] = [combined.initialization];
  for (const index of [0, 1, 2, 3])
    for (const kind of ['video', 'audio'] as const) {
      const part = await read(`${kind}-${index}.m4s`),
        moof = mp4Boxes(part).find((box) => box.type === 'moof')!;
      const track = inspectMp4Init(kind === 'video' ? video : audio)[0]!;
      const original = inspectMoof(part.subarray(moof.start, moof.end), [track])[0]!;
      const output = remapMp4Moof(
        part.subarray(moof.start, moof.end),
        track,
        kind === 'video' ? 1 : 2,
        index * 2 + (kind === 'video' ? 1 : 2),
      );
      const edited = inspectMoof(output, tracks)[0]!;
      expect([edited.base, edited.bytes, edited.dataOffset, edited.duration]).toEqual([
        original.base,
        original.bytes,
        original.dataOffset,
        original.duration,
      ]);
      pieces.push(output, part.subarray(moof.end));
    }
  const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
  expect(encodedSampleProof(Buffer.concat(pieces))).toEqual(encodedSampleProof(source));
  expect(audio).toEqual(before);
});
it('keeps the selected alternate audio payload and its distinct frame order', async () => {
  const init = combineMp4Init(video, await read('alternate-init.mp4'));
  const pieces: Uint8Array[] = [init.initialization];
  for (const index of [0, 1, 2, 3])
    for (const kind of ['video', 'alternate']) {
      const part = await read(`${kind}-${index}.m4s`),
        moof = mp4Boxes(part)[0]!;
      const source = inspectMp4Init(
        kind === 'video' ? video : await read('alternate-init.mp4'),
      )[0]!;
      pieces.push(
        remapMp4Moof(
          part.subarray(0, moof.end),
          source,
          kind === 'video' ? 1 : 2,
          index * 2 + (kind === 'video' ? 1 : 2),
        ),
        part.subarray(moof.end),
      );
    }
  const source = encodedSampleProof(
    await readFile(new URL('../fixtures/media/source.mp4', import.meta.url)),
  );
  const actual = encodedSampleProof(Buffer.concat(pieces));
  expect(actual.video).toEqual(source.video);
  expect(actual.audio).toEqual([...source.audio.slice(94), ...source.audio.slice(0, 94)]);
});
it('pairs first media sources for one common origin and orders remaining source starts', async () => {
  const v = parseHls((await read('video.m3u8')).toString(), 'https://example.org/video.m3u8');
  const a = parseHls((await read('audio.m3u8')).toString(), 'https://example.org/audio.m3u8');
  const plan = pairHlsPlans(v, a);
  expect(plan.sourceParts).toBe(8);
  expect(plan.parts).toHaveLength(7);
  expect(plan.parts[0]!.companion?.track).toBe('audio');
  expect(plan.parts[1]!.track).toBe('audio');
  if (a.kind !== 'media') throw Error('Expected media');
  expect(() => pairHlsPlans(v, { ...a, duration: 100 })).toThrow(/durations/);
  expect(() => pairHlsPlans(v, { ...a, init: undefined })).toThrow(/fragmented-MP4/);
});
it('refuses a muxed or wrong-kind initialization rather than silently stripping a track', async () => {
  expect(() => combineMp4Init(audio, video)).toThrow(/video-only/);
  const full = await readFile(new URL('../fixtures/media/init.mp4', import.meta.url));
  expect(() => combineMp4Init(full, audio)).toThrow(/video-only/);
});
