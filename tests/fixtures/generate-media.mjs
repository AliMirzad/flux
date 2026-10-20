// Development fixture generator. The shipped extension never runs an encoder/helper.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectMp4Init, inspectMoof, mp4Boxes } from '../../src/engine/media/mp4.ts';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  const bytes = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext('2d');
      const audio = new AudioContext();
      await audio.resume();
      const destination = audio.createMediaStreamDestination();
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      gain.gain.value = 0.1;
      tone.connect(gain).connect(destination);
      const stream = canvas.captureStream(15);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        videoBitsPerSecond: 150000,
        audioBitsPerSecond: 64000,
        videoKeyFrameIntervalDuration: 1000,
      });
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const finished = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      const started = performance.now();
      const paint = () => {
        const elapsed = performance.now() - started;
        const part = elapsed < 1300 ? 0 : elapsed < 2700 ? 1 : 2;
        context.fillStyle = ['#ff0000', '#00ff00', '#0000ff'][part];
        context.fillRect(0, 0, canvas.width, canvas.height);
        tone.frequency.value = [440, 880, 1320][part];
      };
      paint();
      const timer = setInterval(paint, 30);
      tone.start();
      recorder.start(1000);
      await new Promise((resolve) => setTimeout(resolve, 4100));
      recorder.stop();
      await finished;
      clearInterval(timer);
      tone.stop();
      stream.getTracks().forEach((track) => track.stop());
      await audio.close();
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }),
  );
  const boxes = [];
  for (let offset = 0; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (size < 8 || offset + size > bytes.length) throw Error('Unexpected recorder box boundary');
    boxes.push({ type: bytes.toString('ascii', offset + 4, offset + 8), offset, size });
    offset += size;
  }
  const first = boxes.find((box) => box.type === 'moof')?.offset;
  if (first === undefined) throw Error('Recorder did not create fragmented MP4');
  const directory = 'tests/fixtures/media';
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/source.mp4`, bytes);
  await writeFile(`${directory}/init.mp4`, bytes.subarray(0, first));
  const fragments = boxes.filter((box) => box.type === 'moof').map((box) => box.offset);
  const tracks = inspectMp4Init(bytes.subarray(0, first));
  const videoTrack = tracks.find((track) => track.kind === 'video');
  const timing = fragments.map((at, index) => {
    const part = bytes.subarray(at, fragments[index + 1] ?? bytes.length);
    const moof = mp4Boxes(part).find((box) => box.type === 'moof');
    return inspectMoof(part.subarray(moof.start, moof.end), tracks).find(
      (track) => track.id === videoTrack.id,
    );
  });
  const durations = timing.map(
    (track, index) =>
      ((timing[index + 1]?.base ?? track.base + track.duration) - track.base) /
      videoTrack.timescale,
  );
  for (let index = 0; index < fragments.length; index++)
    await writeFile(
      `${directory}/part-${index}.m4s`,
      bytes.subarray(fragments[index], fragments[index + 1] ?? bytes.length),
    );
  await writeFile(
    `${directory}/vod.m3u8`,
    [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...durations))}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-MAP:URI="init.mp4"',
      ...durations.flatMap((duration, index) => [
        `#EXTINF:${duration.toFixed(6)},`,
        `part-${index}.m4s`,
      ]),
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'),
  );
  const info = {
    source: 'Locally synthesized canvas colors and oscillator tones; no third-party media.',
    chrome: browser.version(),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fragments: fragments.length,
    boxes: boxes.map(({ type, size }) => ({ type, size })),
    markers: [
      { at: 0.5, color: 'red', toneHz: 440 },
      { at: 2, color: 'green', toneHz: 880 },
      { at: 3.5, color: 'blue', toneHz: 1320 },
    ],
  };
  await writeFile(`${directory}/fixture.json`, JSON.stringify(info, null, 2) + '\n');
  console.log(JSON.stringify(info));
} finally {
  await browser.close();
}
