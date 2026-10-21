import { createHash } from 'node:crypto';
import { inspectMoof, inspectMp4Init, mp4Boxes, type Box } from '../../src/engine/media/mp4';

/** Encoded frame identity, independent of container addresses, timestamps and added AVC parameter sets. */
export function encodedSampleProof(input: Uint8Array) {
  const data = Buffer.from(input),
    top = mp4Boxes(data);
  const first = top.find((box) => box.type === 'moof')!;
  const tracks = inspectMp4Init(data.subarray(0, first.start));
  const child = (parent: Box, type: string) =>
    mp4Boxes(data, parent.body, parent.end).find((box) => box.type === type)!;
  const proof = { audio: [] as string[], video: [] as string[] };
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  for (const moof of top.filter((box) => box.type === 'moof')) {
    const entries = inspectMoof(data.subarray(moof.start, moof.end), tracks);
    for (const traf of mp4Boxes(data, moof.body, moof.end).filter((box) => box.type === 'traf')) {
      const tfhd = child(traf, 'tfhd'),
        flags = data.readUInt32BE(tfhd.body) & 0xffffff;
      const track = tracks.find((track) => track.id === data.readUInt32BE(tfhd.body + 4))!;
      const entry = entries.find((entry) => entry.id === track.id)!;
      const defaultAt = tfhd.body + 8 + (flags & 2 ? 4 : 0) + (flags & 8 ? 4 : 0);
      const defaultSize = flags & 16 ? data.readUInt32BE(defaultAt) : track.defaultSize;
      const run = child(traf, 'trun'),
        runFlags = data.readUInt32BE(run.body) & 0xffffff;
      const count = data.readUInt32BE(run.body + 4);
      let position = run.body + 12 + (runFlags & 4 ? 4 : 0),
        offset = moof.start + entry.dataOffset;
      for (let index = 0; index < count; index++) {
        if (runFlags & 0x100) position += 4;
        const size = runFlags & 0x200 ? data.readUInt32BE(position) : defaultSize;
        if (runFlags & 0x200) position += 4;
        if (runFlags & 0x400) position += 4;
        if (runFlags & 0x800) position += 4;
        const sample = data.subarray(offset, offset + size);
        offset += size;
        if (sample.length !== size || !size) throw new Error('Invalid sample proof boundary.');
        if (track.kind === 'audio') proof.audio.push(digest(sample));
        else {
          const vcl: Uint8Array[] = [];
          for (let at = 0; at < sample.length;) {
            const length = sample.readUInt32BE(at);
            at += 4;
            if (!length || at + length > sample.length)
              throw new Error('Invalid AVC proof length.');
            const type = sample[at]! & 31;
            if (type >= 1 && type <= 5) vcl.push(sample.subarray(at, at + length));
            at += length;
          }
          if (!vcl.length) throw new Error('Missing encoded video frame.');
          proof.video.push(digest(Buffer.concat(vcl)));
        }
      }
    }
  }
  return proof;
}
