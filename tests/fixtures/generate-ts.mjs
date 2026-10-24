import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { directory, pat, pmt, packetize, pes, elementary, samples } from './ts-source.mjs';
const playlist = await readFile(new URL('vod.m3u8', directory), 'utf8');
const count = (playlist.match(/part-\d+\.m4s/g) ?? []).length;
const details = [];
for (let index = 0; index < count; index++) {
  const input = await readFile(new URL(`part-${index}.m4s`, directory));
  const packets = [
    ...packetize(0, Buffer.concat([Buffer.from([0]), pat])),
    ...packetize(4096, Buffer.concat([Buffer.from([0]), pmt])),
  ];
  for (const sample of samples(input))
    packets.push(
      ...pes(sample.track, elementary(sample.track, sample.data), sample.dts, sample.pts),
    );
  const output = Buffer.concat(packets);
  await writeFile(new URL(`part-${index}.mpegts`, directory), output);
  details.push({
    part: index,
    bytes: output.length,
    packets: packets.length,
    sha256: createHash('sha256').update(output).digest('hex'),
  });
}
await writeFile(
  new URL('ts-vod.m3u8', directory),
  playlist
    .replace('#EXT-X-MAP:URI="init.mp4"\n', '')
    .replace(/\.m4s/g, '.ts')
    .replace('#EXT-X-VERSION:7', '#EXT-X-VERSION:3'),
);
await writeFile(
  new URL('ts-fixture.json', directory),
  JSON.stringify(
    {
      source: 'Locally generated MPEG-TS from our own synthetic H.264/AAC fixture.',
      clockOrigin: 90000,
      parts: details,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    generatedParts: count,
    totalBytes: details.reduce((total, part) => total + part.bytes, 0),
  }),
);
