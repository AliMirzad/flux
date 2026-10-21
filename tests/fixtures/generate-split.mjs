// Development only: split our own fixture's encoded samples, with colliding input track ids.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectMp4Init, inspectMoof, mp4Boxes } from '../../src/engine/media/mp4.ts';
const directory = new URL('./media/split/', import.meta.url);
await mkdir(directory, { recursive: true });
const init = await readFile(new URL('./media/init.mp4', import.meta.url)),
  tracks = inspectMp4Init(init);
const child = (data, parent, type) =>
  mp4Boxes(data, parent.body, parent.end).find((box) => box.type === type);
const box = (type, payloads) => {
  const data = Buffer.concat(payloads),
    out = Buffer.alloc(8 + data.length);
  out.writeUInt32BE(out.length);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  return out;
};
const top = mp4Boxes(init),
  moov = top.find((box) => box.type === 'moov'),
  mvhd = child(init, moov, 'mvhd');
function initialization(kind, language) {
  const track = tracks.find((track) => track.kind === kind);
  const trak = mp4Boxes(init, moov.body, moov.end).find((box) => {
    if (box.type !== 'trak') return false;
    const tkhd = child(init, box, 'tkhd');
    return init.readUInt32BE(tkhd.body + (init[tkhd.body] ? 20 : 12)) === track.id;
  });
  const trex = mp4Boxes(init, child(init, moov, 'mvex').body, child(init, moov, 'mvex').end).find(
    (box) => init.readUInt32BE(box.body + 4) === track.id,
  );
  const copied = Buffer.from(init);
  const tkhd = child(init, trak, 'tkhd');
  copied.writeUInt32BE(1, tkhd.body + (init[tkhd.body] ? 20 : 12));
  copied.writeUInt32BE(1, trex.body + 4);
  if (language) {
    const mdhd = child(init, child(init, trak, 'mdia'), 'mdhd');
    copied.writeUInt16BE(
      [...language].reduce((value, char) => (value << 5) | (char.charCodeAt(0) - 96), 0),
      mdhd.body + (init[mdhd.body] ? 32 : 20),
    );
  }
  return Buffer.concat([
    copied.subarray(top[0].start, top[0].end),
    box('moov', [
      copied.subarray(mvhd.start, mvhd.end),
      copied.subarray(trak.start, trak.end),
      box('mvex', [copied.subarray(trex.start, trex.end)]),
    ]),
  ]);
}
const fragments = await Promise.all(
  [0, 1, 2, 3].map((index) => readFile(new URL(`./media/part-${index}.m4s`, import.meta.url))),
);
function extract(bytes, kind) {
  const moof = mp4Boxes(bytes).find((box) => box.type === 'moof');
  const track = tracks.find((track) => track.kind === kind);
  const entry = inspectMoof(bytes.subarray(moof.start, moof.end), tracks).find(
    (entry) => entry.id === track.id,
  );
  const traf = mp4Boxes(bytes, moof.body, moof.end).find(
    (box) =>
      box.type === 'traf' && bytes.readUInt32BE(child(bytes, box, 'tfhd').body + 4) === track.id,
  );
  const run = child(bytes, traf, 'trun'),
    flags = bytes.readUInt32BE(run.body) & 0xffffff;
  if (!(flags & 0x200)) throw Error('Fixture requires explicit sample sizes.');
  let position = run.body + 12 + (flags & 4 ? 4 : 0),
    at = moof.start + entry.dataOffset;
  const frames = [],
    sizePositions = [];
  for (let index = 0; index < entry.samples; index++) {
    if (flags & 0x100) position += 4;
    const size = bytes.readUInt32BE(position);
    sizePositions.push(position - traf.start);
    position += 4;
    if (flags & 0x400) position += 4;
    if (flags & 0x800) position += 4;
    frames.push(bytes.subarray(at, at + size));
    at += size;
  }
  return { moof, track, entry, traf, frames, sizePositions };
}
const audio = fragments.flatMap((bytes) => extract(bytes, 'audio').frames);
const rotated = [...audio.slice(94), ...audio.slice(0, 94)];
let alternateAt = 0;
const timings = { video: [], audio: [] };
for (const [index, input] of fragments.entries()) {
  for (const kind of ['video', 'audio', 'alternate']) {
    const info = extract(input, kind === 'video' ? 'video' : 'audio');
    const traf = Buffer.from(input.subarray(info.traf.start, info.traf.end));
    const frames =
      kind === 'alternate'
        ? rotated.slice(alternateAt, alternateAt + info.frames.length)
        : info.frames;
    if (kind === 'alternate') alternateAt += frames.length;
    const tfhd = child(traf, { body: 8, end: traf.length }, 'tfhd');
    traf.writeUInt32BE(1, tfhd.body + 4);
    frames.forEach((frame, at) => traf.writeUInt32BE(frame.length, info.sizePositions[at]));
    const mfhd = child(input, info.moof, 'mfhd');
    const moof = box('moof', [input.subarray(mfhd.start, mfhd.end), traf]);
    const newTraf = child(moof, { body: 8, end: moof.length }, 'traf'),
      run = child(moof, newTraf, 'trun');
    moof.writeInt32BE(moof.length + 8, run.body + 8);
    const output = Buffer.concat([moof, box('mdat', frames)]);
    await writeFile(new URL(`${kind}-${index}.m4s`, directory), output);
    if (kind !== 'alternate')
      timings[kind].push({
        start: info.entry.base / info.track.timescale,
        duration: info.entry.duration / info.track.timescale,
      });
  }
}
const durations = Object.fromEntries(
  Object.entries(timings).map(([kind, entries]) => [
    kind,
    entries.map((entry, index) =>
      entries[index + 1] ? entries[index + 1].start - entry.start : entry.duration,
    ),
  ]),
);
await writeFile(new URL('video-init.mp4', directory), initialization('video'));
await writeFile(new URL('audio-init.mp4', directory), initialization('audio', 'eng'));
await writeFile(new URL('alternate-init.mp4', directory), initialization('audio', 'fas'));
for (const kind of ['video', 'audio', 'alternate']) {
  const times = durations[kind === 'alternate' ? 'audio' : kind];
  const text = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:0',
    `#EXT-X-MAP:URI="${kind}-init.mp4"`,
    ...times.flatMap((duration, index) => [
      `#EXTINF:${duration.toFixed(9)},`,
      `${kind}-${index}.m4s`,
    ]),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
  await writeFile(new URL(`${kind}.m3u8`, directory), text);
}
await writeFile(
  new URL('master.m3u8', directory),
  '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="Original tones",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="Alternate tones",LANGUAGE="fa",DEFAULT=NO,AUTOSELECT=YES,URI="alternate.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=160x90,CODECS="avc1.42E01E,mp4a.40.2",AUDIO="stereo"\nvideo.m3u8\n',
);
const digest = (frames) => createHash('sha256').update(Buffer.concat(frames)).digest('hex');
await writeFile(
  new URL('proof.json', directory),
  JSON.stringify(
    {
      ownSyntheticSamples: true,
      collidingSourceTrackIds: true,
      audioFrames: audio.length,
      originalAudioSha256: digest(audio),
      alternateAudioSha256: digest(rotated),
      durations,
    },
    null,
    2,
  ) + '\n',
);
console.log('Generated split MP4 fixtures with two distinct synthetic audio renditions.');
