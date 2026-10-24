import { inspectMp4Init, mp4Boxes, type Box } from './mp4';
import type { VideoConfig } from './vendor/mux-transmuxer.js';

/** Restore codec context from the verified durable initialization, never remote state. */
export function transportVideoConfig(data: Uint8Array): VideoConfig | undefined {
  if (data.length > 1048576) throw new Error('TS initialization exceeds 1 MiB.');
  const tracks = inspectMp4Init(data);
  if (!tracks.some((track) => track.kind === 'video')) return undefined;
  const child = (parent: Box, name: string) => {
    const entries = mp4Boxes(data, parent.body, parent.end).filter((box) => box.type === name);
    if (entries.length !== 1) throw new Error('Missing TS codec context.');
    return entries[0]!;
  };
  const moov = mp4Boxes(data).find((box) => box.type === 'moov')!;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const trak of mp4Boxes(data, moov.body, moov.end).filter((box) => box.type === 'trak')) {
    const tkhd = child(trak, 'tkhd');
    const id = view.getUint32(tkhd.body + (data[tkhd.body] ? 20 : 12));
    if (tracks.find((track) => track.id === id)?.kind !== 'video') continue;
    const stsd = child(child(child(child(trak, 'mdia'), 'minf'), 'stbl'), 'stsd');
    const sample = mp4Boxes(data, stsd.body + 8, stsd.end)[0]!;
    const avc = mp4Boxes(data, sample.start + 86, sample.end).find((box) => box.type === 'avcC');
    if (!avc || avc.body + 7 > avc.end) throw new Error('Missing TS AVC context.');
    let cursor = avc.body + 6;
    const units = (count: number) => {
      const output: Uint8Array[] = [];
      if (!count || count > 31) throw new Error('Invalid TS AVC parameter count.');
      for (let i = 0; i < count; i++) {
        if (cursor + 2 > avc.end) throw new Error('Truncated AVC parameter set.');
        const size = view.getUint16(cursor);
        cursor += 2;
        if (!size || size > 65535 || cursor + size > avc.end)
          throw new Error('Invalid AVC parameter set.');
        output.push(data.slice(cursor, cursor + size));
        cursor += size;
      }
      return output;
    };
    const sps = units(data[avc.body + 5]! & 31),
      pps = units(data[cursor++]!);
    const pasp = mp4Boxes(data, sample.start + 86, sample.end).find((box) => box.type === 'pasp');
    return {
      sps,
      pps,
      ...(pasp && pasp.end - pasp.body === 8
        ? {
            sarRatio: [view.getUint32(pasp.body), view.getUint32(pasp.body + 4)] as [
              number,
              number,
            ],
          }
        : {}),
      width: view.getUint16(sample.start + 32),
      height: view.getUint16(sample.start + 34),
      profileIdc: data[avc.body + 1]!,
      profileCompatibility: data[avc.body + 2]!,
      levelIdc: data[avc.body + 3]!,
    };
  }
  throw new Error('Missing TS video context.');
}
