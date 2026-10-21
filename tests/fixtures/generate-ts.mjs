// Development fixture generation only. Converts our own synthetic H.264/AAC samples
// to MPEG-TS; the shipped extension never invokes Node or a native media helper.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mp4Boxes, inspectMp4Init, inspectMoof } from '../../src/engine/media/mp4.ts';

const directory = new URL('./media/', import.meta.url);
const initialization = await readFile(new URL('init.mp4', directory));
const tracks = inspectMp4Init(initialization);
const child = (data, parent, type) => {
  const result = mp4Boxes(data, parent.body, parent.end).filter((box) => box.type === type);
  if (result.length !== 1) throw Error('Expected one fixture box: ' + type);
  return result[0];
};
const moov = mp4Boxes(initialization).find((box) => box.type === 'moov');
const configs = new Map();
for (const trak of mp4Boxes(initialization, moov.body, moov.end).filter(
  (box) => box.type === 'trak',
)) {
  const tkhd = child(initialization, trak, 'tkhd');
  const id = initialization.readUInt32BE(tkhd.body + (initialization[tkhd.body] ? 20 : 12));
  const track = tracks.find((track) => track.id === id);
  const mdia = child(initialization, trak, 'mdia');
  const stsd = child(
    initialization,
    child(initialization, child(initialization, mdia, 'minf'), 'stbl'),
    'stsd',
  );
  const sample = mp4Boxes(initialization, stsd.body + 8, stsd.end)[0];
  if (track.kind === 'video') {
    const avc = mp4Boxes(initialization, sample.start + 86, sample.end).find(
      (box) => box.type === 'avcC',
    );
    if (!avc || (initialization[avc.body + 4] & 3) !== 3)
      throw Error('Fixture needs four-byte AVC NAL lengths.');
    let position = avc.body + 6;
    const units = [];
    const readUnits = (count) => {
      for (let index = 0; index < count; index++) {
        const length = initialization.readUInt16BE(position);
        position += 2;
        if (!length || position + length > avc.end)
          throw Error('Invalid fixture AVC parameter set.');
        units.push(initialization.subarray(position, position + length));
        position += length;
      }
    };
    readUnits(initialization[avc.body + 5] & 31);
    readUnits(initialization[position++]);
    configs.set(id, { units });
  } else {
    const rate = initialization.readUInt32BE(sample.start + 32) >>> 16;
    const channels = initialization.readUInt16BE(sample.start + 24);
    const rateIndex = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
    ].indexOf(rate);
    if (rateIndex < 0 || channels < 1 || channels > 7)
      throw Error('Unsupported fixture AAC configuration.');
    configs.set(id, { rateIndex, channels });
  }
}
const crc = (data) => {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte << 24;
    for (let bit = 0; bit < 8; bit++)
      value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
  }
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value >>> 0);
  return Buffer.concat([data, result]);
};
const pat = crc(Buffer.from([0, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0]));
const pmt = crc(
  Buffer.from([
    2, 0xb0, 23, 0, 1, 0xc1, 0, 0, 0xe1, 0, 0xf0, 0, 0x1b, 0xe1, 0, 0xf0, 0, 0x0f, 0xe1, 1, 0xf0, 0,
  ]),
);
const continuity = new Map();
function packetize(pid, bytes, pcr) {
  const result = [];
  let position = 0;
  while (position < bytes.length) {
    const first = position === 0,
      withPcr = first && pcr !== undefined;
    const length = Math.min(bytes.length - position, withPcr ? 176 : 184);
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = (first ? 0x40 : 0) | (pid >> 8);
    packet[2] = pid & 255;
    const counter = continuity.get(pid) ?? 0;
    continuity.set(pid, (counter + 1) % 16);
    let payload = 4;
    if (length < 184) {
      const adaptation = 183 - length;
      packet[3] = 0x30 | counter;
      packet[4] = adaptation;
      if (adaptation) packet[5] = withPcr ? 0x10 : 0;
      if (withPcr) {
        packet[6] = Math.floor(pcr / 2 ** 25) & 255;
        packet[7] = Math.floor(pcr / 2 ** 17) & 255;
        packet[8] = Math.floor(pcr / 2 ** 9) & 255;
        packet[9] = Math.floor(pcr / 2) & 255;
        packet[10] = ((pcr % 2) * 128) | 0x7e;
        packet[11] = 0;
      }
      payload = 5 + adaptation;
    } else packet[3] = 0x10 | counter;
    bytes.copy(packet, payload, position, position + length);
    position += length;
    result.push(packet);
  }
  return result;
}
function timestamp(value, prefix) {
  value = Math.round(value) % 2 ** 33;
  return Buffer.from([
    (prefix << 4) | ((Math.floor(value / 2 ** 30) & 7) << 1) | 1,
    Math.floor(value / 2 ** 22) & 255,
    ((Math.floor(value / 2 ** 15) & 127) << 1) | 1,
    Math.floor(value / 2 ** 7) & 255,
    ((value & 127) << 1) | 1,
  ]);
}
function pes(track, data, dts, pts) {
  const video = track.kind === 'video';
  const both = dts !== pts;
  const times = Buffer.concat([timestamp(pts, both ? 3 : 2), ...(both ? [timestamp(dts, 1)] : [])]);
  const header = Buffer.alloc(9);
  header.set([0, 0, 1, video ? 0xe0 : 0xc0]);
  if (!video) header.writeUInt16BE(data.length + times.length + 3, 4);
  header[6] = 0x80;
  header[7] = both ? 0xc0 : 0x80;
  header[8] = times.length;
  return packetize(
    video ? 256 : 257,
    Buffer.concat([header, times, data]),
    video ? dts : undefined,
  );
}
function elementary(track, sample) {
  const config = configs.get(track.id);
  if (track.kind === 'video') {
    const units = [];
    for (let offset = 0; offset < sample.length;) {
      const length = sample.readUInt32BE(offset);
      offset += 4;
      if (!length || offset + length > sample.length) throw Error('Invalid fixture NAL sample.');
      units.push(sample.subarray(offset, offset + length));
      offset += length;
    }
    const key = units.some((unit) => (unit[0] & 31) === 5);
    return Buffer.concat([
      Buffer.from([0, 0, 0, 1, 9, 0xf0]),
      ...(key ? config.units : []).flatMap((unit) => [Buffer.from([0, 0, 0, 1]), unit]),
      ...units.flatMap((unit) => [Buffer.from([0, 0, 0, 1]), unit]),
    ]);
  }
  const length = sample.length + 7;
  if (length > 8191) throw Error('Fixture AAC frame is too large.');
  return Buffer.concat([
    Buffer.from([
      0xff,
      0xf1,
      (1 << 6) | (config.rateIndex << 2) | (config.channels >> 2),
      ((config.channels & 3) << 6) | (length >> 11),
      (length >> 3) & 255,
      ((length & 7) << 5) | 31,
      0xfc,
    ]),
    sample,
  ]);
}
function samples(bytes) {
  const moof = mp4Boxes(bytes).find((box) => box.type === 'moof');
  const entries = inspectMoof(bytes.subarray(moof.start, moof.end), tracks);
  const result = [];
  for (const traf of mp4Boxes(bytes, moof.body, moof.end).filter((box) => box.type === 'traf')) {
    const tfhd = child(bytes, traf, 'tfhd'),
      flags = bytes.readUInt32BE(tfhd.body) & 0xffffff;
    const track = tracks.find((track) => track.id === bytes.readUInt32BE(tfhd.body + 4));
    const entry = entries.find((entry) => entry.id === track.id);
    let cursor = tfhd.body + 8 + (flags & 2 ? 4 : 0);
    const defaultDuration = flags & 8 ? bytes.readUInt32BE(cursor) : track.defaultDuration;
    if (flags & 8) cursor += 4;
    const defaultSize = flags & 16 ? bytes.readUInt32BE(cursor) : track.defaultSize;
    const run = child(bytes, traf, 'trun'),
      runFlags = bytes.readUInt32BE(run.body) & 0xffffff;
    const count = bytes.readUInt32BE(run.body + 4);
    let position = run.body + 12 + (runFlags & 4 ? 4 : 0);
    let offset = moof.start + entry.dataOffset,
      base = entry.base;
    for (let index = 0; index < count; index++) {
      const duration = runFlags & 0x100 ? bytes.readUInt32BE(position) : defaultDuration;
      if (runFlags & 0x100) position += 4;
      const size = runFlags & 0x200 ? bytes.readUInt32BE(position) : defaultSize;
      if (runFlags & 0x200) position += 4;
      if (runFlags & 0x400) position += 4;
      let composition = 0;
      if (runFlags & 0x800) {
        composition =
          bytes[run.body] === 1 ? bytes.readInt32BE(position) : bytes.readUInt32BE(position);
        position += 4;
      }
      if (offset + size > bytes.length) throw Error('Fixture sample exceeds payload.');
      const dts = Math.round((base / track.timescale) * 90000) + 90000;
      const pts = Math.round(((base + composition) / track.timescale) * 90000) + 90000;
      result.push({ track, dts, pts, data: bytes.subarray(offset, offset + size) });
      base += duration;
      offset += size;
    }
  }
  return result.sort((a, b) => a.dts - b.dts || a.track.id - b.track.id);
}
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
