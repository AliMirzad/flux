import { readFile, writeFile } from 'node:fs/promises';
import { directory, crc, pat, packetize, pes, elementary, samples } from './ts-source.mjs';
const source = await readFile(new URL('vod.m3u8', directory), 'utf8');
for (const kind of ['video', 'audio']) {
  const pid = kind === 'video' ? 256 : 257,
    type = kind === 'video' ? 0x1b : 0x0f;
  const pmt = crc(
    Buffer.from([
      2,
      0xb0,
      18,
      0,
      1,
      0xc1,
      0,
      0,
      0xe0 | (pid >> 8),
      pid & 255,
      0xf0,
      0,
      type,
      0xe0 | (pid >> 8),
      pid & 255,
      0xf0,
      0,
    ]),
  );
  for (let index = 0; index < 4; index++) {
    const input = await readFile(new URL(`part-${index}.m4s`, directory));
    const packets = [
      ...packetize(0, Buffer.concat([Buffer.from([0]), pat])),
      ...packetize(4096, Buffer.concat([Buffer.from([0]), pmt])),
    ];
    for (const sample of samples(input).filter((sample) => sample.track.kind === kind))
      packets.push(
        ...pes(sample.track, elementary(sample.track, sample.data), sample.dts, sample.pts),
      );
    await writeFile(new URL(`split/ts-${kind}-${index}.mpegts`, directory), Buffer.concat(packets));
  }
  await writeFile(
    new URL(`split/ts-${kind}.m3u8`, directory),
    source
      .replace('#EXT-X-MAP:URI="init.mp4"\n', '')
      .replace(/part-(\d+)\.m4s/g, `ts-${kind}-$1.ts`),
  );
}
