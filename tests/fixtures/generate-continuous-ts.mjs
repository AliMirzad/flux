import { readFile, writeFile } from 'node:fs/promises';
import { directory, crc, pat, pmt, packetize, pes, elementary, samples } from './ts-source.mjs';
// Split between access units, deliberately between keyframes. Extended PMT crosses packets.
const playlist = await readFile(new URL('vod.m3u8', directory), 'utf8');
const durations = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].map((match) => Number(match[1]));
const all = [];
const details = [];
for (let i = 0; i < durations.length; i++) {
  const list = samples(await readFile(new URL('part-' + i + '.m4s', directory)));
  const video = list.filter((sample) => sample.track.kind === 'video');
  const split = i === 0 ? video[Math.floor(video.length / 2)].dts : Infinity;
  const groups =
    i === 0
      ? [list.filter((sample) => sample.dts < split), list.filter((sample) => sample.dts >= split)]
      : [list];
  for (const [ordinal, group] of groups.entries()) {
    const start = video[0].dts,
      half = (split - start) / 90000;
    const duration = i === 0 ? (ordinal === 0 ? half : durations[i] - half) : durations[i];
    const header = Buffer.from(pmt.subarray(0, 12));
    header[10] = 0xf0;
    header[11] = 200;
    const body = Buffer.concat([
      header,
      Buffer.from([0x80, 198]),
      Buffer.alloc(198),
      pmt.subarray(12, -4),
    ]);
    body[1] = 0xb0 | ((body.length + 1) >> 8);
    body[2] = (body.length + 1) & 255;
    const extended = crc(body);
    const packets = [
      ...packetize(0, Buffer.concat([Buffer.from([0]), pat])),
      ...packetize(4096, Buffer.concat([Buffer.from([0]), extended])),
    ];
    for (const sample of group)
      packets.push(
        ...pes(sample.track, elementary(sample.track, sample.data), sample.dts, sample.pts),
      );
    const name = 'continuous-' + all.length;
    const output = Buffer.concat(packets);
    await writeFile(new URL(name + '.mpegts', directory), output);
    all.push('#EXTINF:' + duration + ',\n' + name + '.ts');
    details.push({ name, duration, samples: group.length });
  }
}
await writeFile(
  new URL('continuous-vod.m3u8', directory),
  '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n' + all.join('\n') + '\n#EXT-X-ENDLIST\n',
);
console.log(JSON.stringify(details));
