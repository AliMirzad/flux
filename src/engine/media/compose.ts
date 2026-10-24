import { inspectMp4Init, inspectMoof, mp4Boxes, type Box, type Mp4Track } from './mp4';
import type { HlsManifest, HlsPart } from './hls';

export type MediaKind = 'video' | 'audio';
export interface HlsStep extends HlsPart {
  track?: MediaKind;
  companion?: HlsPart & { track: MediaKind };
  expectedEnds?: Partial<Record<MediaKind, number>>;
}
export function pairHlsPlans(video: HlsManifest, audio: HlsManifest) {
  if (video.kind !== 'media' || audio.kind !== 'media' || !video.init || !audio.init)
    throw new Error(
      'Separate audio currently requires completed fragmented-MP4 video and audio playlists.',
    );
  if (Math.abs(video.duration - audio.duration) > 0.5)
    throw new Error('The selected audio and video playlist durations do not match.');
  if (video.parts.length + audio.parts.length > 32768)
    throw new Error('The combined HLS presentation has too many source parts.');
  const remaining: { part: HlsStep; at: number; order: number }[] = [];
  for (const [order, plan] of [video, audio].entries()) {
    const track: MediaKind = order ? 'audio' : 'video';
    let at = 0;
    for (const [index, part] of plan.parts.entries()) {
      if (index)
        remaining.push({
          part: { ...part, track, expectedEnds: { [track]: at + part.duration! } },
          at,
          order,
        });
      at += part.duration!;
    }
  }
  remaining.sort((a, b) => a.at - b.at || a.order - b.order);
  return {
    init: {
      ...video.init,
      track: 'video',
      companion: { ...audio.init, track: 'audio' },
    } as HlsStep,
    parts: [
      {
        ...video.parts[0]!,
        track: 'video',
        companion: { ...audio.parts[0]!, track: 'audio' },
        expectedEnds: { video: video.parts[0]!.duration!, audio: audio.parts[0]!.duration! },
      },
      ...remaining.map((item) => item.part),
    ] as HlsStep[],
    duration: Math.max(video.duration, audio.duration),
    sourceParts: video.parts.length + audio.parts.length,
    transport: 'mp4' as const,
  };
}

function one(data: Uint8Array, parent: Box, type: string) {
  const boxes = mp4Boxes(data, parent.body, parent.end).filter((box) => box.type === type);
  if (boxes.length !== 1) throw new Error('Composition requires exactly one MP4 ' + type + ' box.');
  return boxes[0]!;
}
function join(arrays: Uint8Array[]) {
  const size = arrays.reduce((sum, array) => sum + array.length, 0);
  if (size > 1048576) throw new Error('Combined MP4 initialization exceeds 1 MiB.');
  const output = new Uint8Array(size);
  let at = 0;
  for (const array of arrays) {
    output.set(array, at);
    at += array.length;
  }
  return output;
}
function box(type: string, parts: Uint8Array[]) {
  const payload = join(parts),
    result = new Uint8Array(8 + payload.length);
  if (result.length > 1048576) throw new Error('Combined MP4 initialization exceeds 1 MiB.');
  new DataView(result.buffer).setUint32(0, result.length);
  for (let i = 0; i < 4; i++) result[4 + i] = type.charCodeAt(i);
  result.set(payload, 8);
  return result;
}
/** Merge track metadata, preserving codec configuration and original timescales. No media samples are decoded. */
export function combineMp4Init(video: Uint8Array, audio: Uint8Array) {
  const sourceIds: Record<MediaKind, number> = { video: 0, audio: 0 };
  const entries = (
    [
      ['video', video, 1],
      ['audio', audio, 2],
    ] as const
  ).map(([kind, input, target]) => {
    const tracks = inspectMp4Init(input);
    if (tracks.length !== 1 || tracks[0]!.kind !== kind)
      throw new Error(`Choose a ${kind}-only MP4 rendition for separate-track composition.`);
    sourceIds[kind] = tracks[0]!.id;
    const data = Uint8Array.from(input),
      view = new DataView(data.buffer);
    const top = mp4Boxes(data),
      moov = top.find((item) => item.type === 'moov')!;
    const trak = one(data, moov, 'trak');
    if (mp4Boxes(data, trak.body, trak.end).some((item) => item.type === 'tref'))
      throw new Error('MP4 track references require an additional composition workflow.');
    const reset = (header: Box, minimum: number, v0: number, v1: number) => {
      const version = data[header.body];
      if (
        (version !== 0 && version !== 1) ||
        header.end - header.body < minimum + (version ? 12 : 0)
      )
        throw new Error('Truncated or unsupported MP4 ' + header.type + ' header.');
      const at = header.body + (version ? v1 : v0);
      if (version) view.setBigUint64(at, 0n);
      else view.setUint32(at, 0);
    };
    const mvhd = one(data, moov, 'mvhd');
    reset(mvhd, 100, 16, 24);
    view.setUint32(mvhd.body + (data[mvhd.body] ? 108 : 96), 3);
    const tkhd = one(data, trak, 'tkhd');
    reset(tkhd, 84, 20, 28);
    view.setUint32(tkhd.body + (data[tkhd.body] ? 20 : 12), target);
    reset(one(data, one(data, trak, 'mdia'), 'mdhd'), 24, 16, 24);
    const trex = one(data, one(data, moov, 'mvex'), 'trex');
    view.setUint32(trex.body + 4, target);
    return { data, moov, mvhd, trak, trex, top };
  });
  const [v, a] = entries as [(typeof entries)[number], (typeof entries)[number]];
  const slice = (item: typeof v, entry: Box) => item.data.subarray(entry.start, entry.end);
  const other = mp4Boxes(v.data, v.moov.body, v.moov.end).filter(
    (item) => !['mvhd', 'trak', 'mvex'].includes(item.type),
  );
  const output = join([
    slice(
      v,
      v.top.find((item) => item.type === 'ftyp')!,
    ),
    box('moov', [
      slice(v, v.mvhd),
      slice(v, v.trak),
      slice(a, a.trak),
      box('mvex', [slice(v, v.trex), slice(a, a.trex)]),
      ...other.map((item) => slice(v, item)),
    ]),
  ]);
  inspectMp4Init(output);
  return { initialization: output, sourceIds };
}

/** Fixed-width edits leave every moof-relative sample address and encoded byte intact. */
export function remapMp4Moof(
  input: Uint8Array,
  source: Mp4Track,
  target: number,
  sequence: number,
) {
  const entries = inspectMoof(input, [source]);
  if (
    entries.length !== 1 ||
    !Number.isInteger(target) ||
    target < 1 ||
    target > 0xffffffff ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > 0xffffffff
  )
    throw new Error('Invalid MP4 track composition identity or sequence.');
  const data = Uint8Array.from(input),
    moof = mp4Boxes(data)[0]!,
    view = new DataView(data.buffer);
  const tfhd = one(data, one(data, moof, 'traf'), 'tfhd'),
    mfhd = one(data, moof, 'mfhd');
  if (mfhd.end - mfhd.body !== 8 || view.getUint32(mfhd.body) !== 0)
    throw new Error('Invalid MP4 movie fragment sequence metadata.');
  view.setUint32(tfhd.body + 4, target);
  view.setUint32(mfhd.body + 4, sequence);
  inspectMoof(data, [{ ...source, id: target }]);
  return data;
}
