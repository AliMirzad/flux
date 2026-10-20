import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseHls } from '../../src/engine/media/hls';
import { inspectMp4Init, inspectMoof, mp4Boxes } from '../../src/engine/media/mp4';
const base = 'https://example.org/hls/vod.m3u8';
const vod = await readFile(new URL('../fixtures/media/vod.m3u8', import.meta.url), 'utf8');
describe('HLS manifest and bounded MP4 metadata', () => {
  it('resolves a completed MP4 VOD plan and real quality/audio choices', () => {
    const parsed = parseHls(vod, base);
    expect(parsed.kind).toBe('media');
    if (parsed.kind !== 'media') throw Error('Expected media');
    expect(parsed.parts).toHaveLength(4);
    expect(parsed.duration).toBeCloseTo(4.0832, 5);
    expect(parsed.init.url).toBe('https://example.org/hls/init.mp4');
    const master = parseHls(
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=200000,CODECS="avc1.42E01E,mp4a.40.2",AUDIO="stereo"\nvideo.m3u8\n',
      base,
    );
    expect(master).toMatchObject({
      kind: 'master',
      variants: [
        { externalAudio: true, bandwidth: 200000, url: 'https://example.org/hls/video.m3u8' },
      ],
    });
  });
  it('handles exact byte ranges and refuses unsafe, encrypted, live and discontinuous inputs', () => {
    const ranged = parseHls(
      vod
        .replace('URI="init.mp4"', 'URI="source.mp4",BYTERANGE="10@0"')
        .replace('part-0.m4s', '#EXT-X-BYTERANGE:5@10\nsource.mp4')
        .replace('part-1.m4s', '#EXT-X-BYTERANGE:7\nsource.mp4'),
      base,
    );
    if (ranged.kind !== 'media') throw Error('Expected media');
    expect(ranged.parts[1]?.range).toEqual({ start: 15, end: 21 });
    for (const source of [
      vod.replace('#EXT-X-ENDLIST', ''),
      vod.replace('part-0.m4s', 'http://127.0.0.1/part'),
      vod.replace('part-0.m4s', 'http://cdn.example.org/part'),
      vod.replace('#EXT-X-MAP:', '#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MAP:'),
      vod.replace('#EXT-X-ENDLIST', '#EXT-X-DISCONTINUITY\n#EXT-X-ENDLIST'),
      vod.replace('part-0.m4s', '#EXT-X-BYTERANGE:5\nsource.mp4'),
    ])
      expect(() => parseHls(source, base)).toThrow();
  });
  it('inspects actual H.264/AAC tracks and exact sample payload bounds without loading media frames', async () => {
    const tracks = inspectMp4Init(
      await readFile(new URL('../fixtures/media/init.mp4', import.meta.url)),
    );
    expect(tracks.map((track) => track.codec)).toEqual(['avc1', 'mp4a']);
    const bytes = await readFile(new URL('../fixtures/media/part-0.m4s', import.meta.url)),
      boxes = mp4Boxes(bytes),
      moof = boxes[0]!,
      mdat = boxes[1]!;
    const entries = inspectMoof(bytes.subarray(moof.start, moof.end), tracks);
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, item) => sum + item.bytes, 0)).toBe(mdat.size - 8);
    const broken = bytes.slice();
    broken.writeUInt32BE(0xffffffff, 0);
    expect(() => mp4Boxes(broken)).toThrow(/boundary/);
    expect(() => inspectMp4Init(new Uint8Array(1048577))).toThrow(/1 MiB/);
  });
});
