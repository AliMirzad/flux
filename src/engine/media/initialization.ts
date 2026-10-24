import { inspectMp4Init, mp4Boxes, type Box } from './mp4';
import type { MediaKind } from './compose';
/** Codec/sample descriptions and timescales must agree; movie dates/durations may change. */
export function assertCompatibleInitialization(
  existing: Uint8Array,
  next: Uint8Array,
  selected?: MediaKind,
) {
  const descriptions = (data: Uint8Array) => {
    const tracks = inspectMp4Init(data),
      view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const child = (parent: Box, kind: string) => {
      const boxes = mp4Boxes(data, parent.body, parent.end).filter((box) => box.type === kind);
      if (boxes.length !== 1) throw new Error('Ambiguous media initialization.');
      return boxes[0]!;
    };
    const moov = mp4Boxes(data).find((box) => box.type === 'moov')!;
    return mp4Boxes(data, moov.body, moov.end)
      .filter((box) => box.type === 'trak')
      .map((trak) => {
        const header = child(trak, 'tkhd'),
          id = view.getUint32(header.body + (data[header.body] ? 20 : 12));
        const track = tracks.find((track) => track.id === id)!;
        const stsd = child(child(child(child(trak, 'mdia'), 'minf'), 'stbl'), 'stsd');
        return {
          id,
          kind: track.kind,
          timescale: track.timescale,
          defaultDuration: track.defaultDuration,
          defaultSize: track.defaultSize,
          bytes: data.subarray(stsd.body, stsd.end),
        };
      });
  };
  const old = descriptions(existing),
    incoming = descriptions(next);
  if (
    selected
      ? incoming.length !== 1 || incoming[0]!.kind !== selected
      : old.length !== incoming.length
  )
    throw new Error('The new period has incompatible tracks.');
  for (const track of incoming) {
    const prior = old.find((item) => item.kind === track.kind);
    if (
      !prior ||
      (!selected && prior.id !== track.id) ||
      prior.timescale !== track.timescale ||
      prior.defaultDuration !== track.defaultDuration ||
      prior.defaultSize !== track.defaultSize ||
      prior.bytes.length !== track.bytes.length ||
      !prior.bytes.every((byte, index) => byte === track.bytes[index])
    )
      throw new Error(
        'The codec, fragment defaults or track configuration changed across periods. Finish retained media and start another download.',
      );
  }
}
