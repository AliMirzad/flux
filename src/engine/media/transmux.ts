import { Transmuxer, type MuxOutput } from './vendor/mux-transmuxer.js';
import { TransportGuard, maxTransportPartBytes } from './transport';
import { mp4Boxes, inspectMp4Init, inspectMoof, type Box } from './mp4';

export interface TransportOutput {
  initialization: Uint8Array;
  media: Uint8Array;
}
export interface TransportPort {
  push(bytes: Uint8Array): Promise<void>;
  finish(duration: number, index: number): Promise<TransportOutput>;
  close(): void;
}
export class TransportConverter {
  private guard = new TransportGuard();
  private converter = new Transmuxer({ keepOriginalTimestamps: true, remux: true });
  private output: MuxOutput | null = null;
  constructor() {
    this.converter.on('data', (output) => {
      if (this.output) throw new Error('A TS part produced multiple incompatible outputs.');
      if (
        output.initSegment.length > 1048576 ||
        output.data.length > maxTransportPartBytes + 1048576
      )
        throw new Error('Converted TS metadata or payload exceeded the supported bound.');
      this.output = output;
    });
  }
  push(bytes: Uint8Array) {
    this.guard.push(bytes);
    this.converter.push(bytes);
  }
  finish(duration: number, index: number): TransportOutput {
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 86400 ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= 32768
    )
      throw new Error('Invalid TS part timing or sequence.');
    this.guard.finish();
    this.converter.flush();
    const output = this.output;
    if (!output) throw new Error('This TS part has no independently decodable H.264/AAC media.');
    const initialization = output.initSegment,
      media = output.data;
    const tracks = inspectMp4Init(initialization);
    const child = (data: Uint8Array, parent: Box, type: string) => {
      const matches = mp4Boxes(data, parent.body, parent.end).filter((box) => box.type === type);
      if (matches.length !== 1) throw new Error('Missing converted MP4 ' + type + ' metadata.');
      return matches[0]!;
    };
    const moov = mp4Boxes(initialization).find((box) => box.type === 'moov')!;
    const resetDuration = (box: Box, version0: number, version1: number) => {
      const version = initialization[box.body];
      const offset = box.body + (version === 1 ? version1 : version0);
      if ((version !== 0 && version !== 1) || offset + (version ? 8 : 4) > box.end)
        throw new Error('Invalid converted MP4 duration metadata.');
      const view = new DataView(
        initialization.buffer,
        initialization.byteOffset,
        initialization.byteLength,
      );
      if (version) view.setBigUint64(offset, 0n);
      else view.setUint32(offset, 0);
    };
    resetDuration(child(initialization, moov, 'mvhd'), 16, 24);
    for (const trak of mp4Boxes(initialization, moov.body, moov.end).filter(
      (box) => box.type === 'trak',
    )) {
      resetDuration(child(initialization, trak, 'tkhd'), 20, 28);
      resetDuration(child(initialization, child(initialization, trak, 'mdia'), 'mdhd'), 16, 24);
    }
    const view = new DataView(media.buffer, media.byteOffset, media.byteLength);
    const moofs = mp4Boxes(media).filter((box) => box.type === 'moof');
    if (!moofs.length || moofs.length > tracks.length)
      throw new Error('Unsupported converted TS fragment layout.');
    for (const [ordinal, moof] of moofs.entries()) {
      const traf = child(media, moof, 'traf'),
        tfhd = child(media, traf, 'tfhd');
      if (tfhd.body + 8 > tfhd.end || view.getUint32(tfhd.body) & 1)
        throw new Error('Unsafe converted TS fragment address.');
      // A single first traf's implicit base is the containing moof. Make it explicit
      // without changing box sizes, encoded samples or relative trun addresses.
      view.setUint32(tfhd.body, view.getUint32(tfhd.body) | 0x20000);
      const mfhd = child(media, moof, 'mfhd');
      if (mfhd.body + 8 > mfhd.end) throw new Error('Truncated converted movie sequence.');
      view.setUint32(mfhd.body + 4, index * 2 + ordinal + 1);
      const entries = inspectMoof(media.subarray(moof.start, moof.end), tracks);
      for (const entry of entries) {
        const track = tracks.find((track) => track.id === entry.id)!;
        if (track.kind !== 'video') continue;
        const run = child(media, traf, 'trun'),
          flags = view.getUint32(run.body) & 0xffffff;
        if (!(flags & 0x100)) throw new Error('Converted video sample durations are missing.');
        const stride = [0x100, 0x200, 0x400, 0x800].filter((flag) => flags & flag).length * 4;
        const position = run.body + 12 + (flags & 4 ? 4 : 0) + (entry.samples - 1) * stride;
        const old = view.getUint32(position);
        const next = Math.round(duration * track.timescale) - (entry.duration - old);
        if (
          !Number.isSafeInteger(next) ||
          next <= 0 ||
          next > 0xffffffff ||
          Math.abs(next - old) > Math.max(track.timescale / 10, old * 2)
        )
          throw new Error('The TS video timing does not match its HLS part duration.');
        // TS has no last-sample duration field. EXTINF supplies the interval to
        // the next logical part, avoiding a guessed last-frame overlap on resume.
        view.setUint32(position, next);
      }
    }
    return { initialization, media };
  }
}
