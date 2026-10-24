import { describe, it, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { TransportConverter } from '../../src/engine/media/transmux';
import { TransportGuard, maxTransportPartBytes } from '../../src/engine/media/transport';
import { inspectMp4Init, mp4Boxes, inspectMoof } from '../../src/engine/media/mp4';
import { encodedSampleProof } from '../fixtures/sample-proof';
const source = await readFile(new URL('../fixtures/media/part-0.mpegts', import.meta.url));
describe('bounded MPEG-TS conversion', () => {
  it('restores codec context and preserves non-keyframe samples across split program tables and tiny reads', async () => {
    const durations = [0.5104666666666666, 0.5399333333333334];
    let initialization: Uint8Array | undefined;
    const fragments: Uint8Array[] = [];
    for (let index = 0; index < 2; index++) {
      const bytes = await readFile(
        new URL(`../fixtures/media/continuous-${index}.mpegts`, import.meta.url),
      );
      const converter = new TransportConverter(initialization);
      for (let at = 0; at < bytes.length; at += 257) converter.push(bytes.subarray(at, at + 257));
      const output = converter.finish(durations[index]!, index);
      if (initialization) expect(output.initialization).toEqual(initialization);
      initialization ??= output.initialization;
      fragments.push(output.media);
      const partial = new TransportGuard();
      partial.push(bytes.subarray(0, 376));
      expect(() => partial.finish()).toThrow(/truncated/);
    }
    const result = encodedSampleProof(Buffer.concat([initialization!, ...fragments]));
    const source = encodedSampleProof(
      await readFile(new URL('../fixtures/media/source.mp4', import.meta.url)),
    );
    expect(result).toEqual({ video: source.video.slice(0, 16), audio: source.audio.slice(0, 44) });
  });
  it('retains both H.264/AAC tracks with explicit relative fragment addresses and declared video duration', () => {
    const converter = new TransportConverter();
    for (let at = 0; at < source.length; at += 257) converter.push(source.subarray(at, at + 257));
    const output = converter.finish(1.0504, 0),
      tracks = inspectMp4Init(output.initialization);
    expect(tracks.map((track) => track.codec).sort()).toEqual(['avc1', 'mp4a']);
    const timing = mp4Boxes(output.media)
      .filter((box) => box.type === 'moof')
      .flatMap((box) => inspectMoof(output.media.subarray(box.start, box.end), tracks));
    expect(timing).toHaveLength(2);
    const video = tracks.find((track) => track.kind === 'video')!;
    expect(timing.find((track) => track.id === video.id)!.duration / video.timescale).toBeCloseTo(
      1.0504,
      5,
    );
  });
  it('does not silently discard video when a part starts before its next keyframe', () => {
    const bytes = Buffer.from(source);
    let changed = false;
    for (let at = 0; at + 5 < bytes.length; at++)
      if (
        bytes[at] === 0 &&
        bytes[at + 1] === 0 &&
        bytes[at + 2] === 0 &&
        bytes[at + 3] === 1 &&
        (bytes[at + 4]! & 31) === 5
      ) {
        bytes[at + 4] = (bytes[at + 4]! & ~31) | 1;
        changed = true;
        break;
      }
    expect(changed).toBe(true);
    const converter = new TransportConverter();
    converter.push(bytes);
    expect(() => converter.finish(1.0504, 0)).toThrow(/between keyframes/);
  });
  it('rejects transport corruption, truncated packets, metadata CRC failure and oversized parts', () => {
    const corrupt = Buffer.from(source);
    corrupt[0] = 0;
    expect(() => new TransportGuard().push(corrupt)).toThrow(/Corrupt/);
    const crc = Buffer.from(source);
    crc[187]! ^= 1;
    expect(() => new TransportGuard().push(crc)).toThrow(/CRC/);
    const partial = new TransportGuard();
    partial.push(source.subarray(0, source.length - 1));
    expect(() => partial.finish()).toThrow(/truncated/);
    expect(() => new TransportGuard().push(new Uint8Array(maxTransportPartBytes + 1))).toThrow(
      /16 MiB/,
    );
  });
  it('terminates malformed AAC frame parsing and enforces a per-part frame budget', async () => {
    const module = new URL('../../src/engine/media/vendor/mux-transmuxer.js', import.meta.url).href;
    const code = `const {parentPort}=require('node:worker_threads'); import(${JSON.stringify(module)}).then(({AdtsStream})=>{
      const results=[];
      for(const kind of ['zero','rate','count']) {
        const stream=new AdtsStream(); const frame=new Uint8Array([255,241,76,128,1,31,252,0]);
        let data=frame;
        if(kind==='zero') {data=frame.slice();data[4]=0;}
        if(kind==='rate') {data=frame.slice();data[2]=124;}
        if(kind==='count') {data=new Uint8Array(frame.length*32769);for(let at=0;at<data.length;at+=8)data.set(frame,at);}
        try {stream.push({type:'audio',data,pts:0,dts:0});results.push('accepted');}catch(error){results.push(error.message);}
      } parentPort.postMessage(results);
    }).catch(error=>parentPort.postMessage({error:error.message}));`;
    const worker = new Worker(code, { eval: true });
    try {
      const result = await new Promise<string[]>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('AAC parser made no progress.')), 2000);
        worker.once('message', (message) => {
          clearTimeout(timeout);
          resolve(message);
        });
        worker.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      expect(result).toEqual([
        'Invalid AAC frame length.',
        'Invalid or excessive AAC frames.',
        'Invalid or excessive AAC frames.',
      ]);
    } finally {
      await worker.terminate();
    }
  });
  it('refuses missing/duplicate transport packets and explicit discontinuities', () => {
    const duplicate = Buffer.concat([source.subarray(0, 188), source]);
    expect(() => new TransportGuard().push(duplicate)).toThrow(/continuity/);
    const packet = Buffer.from(source);
    const adaptation = packet.findIndex(
      (_, at) => at % 188 === 0 && !!(packet[at + 3]! & 0x20) && packet[at + 4]! > 0,
    );
    expect(adaptation).toBeGreaterThanOrEqual(0);
    packet[adaptation + 5]! |= 0x80;
    expect(() => new TransportGuard().push(packet)).toThrow(/discontinuity/);
  });
});
