import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseHls } from '../../src/engine/media/hls';
import { inspectMp4Init, inspectMoof, mp4Boxes } from '../../src/engine/media/mp4';
const base = 'https://example.org/hls/vod.m3u8';
const vod = await readFile(new URL('../fixtures/media/vod.m3u8', import.meta.url), 'utf8');
describe('HLS manifest and bounded MP4 metadata', () => {
  it('retains real language/default choices and rejects unsafe or ambiguous audio groups', async () => {
    const text = await readFile(
      new URL('../fixtures/media/split/master.m3u8', import.meta.url),
      'utf8',
    );
    const master = parseHls(text, base);
    expect(master).toMatchObject({
      kind: 'master',
      audio: [
        {
          name: 'Original tones',
          language: 'en',
          default: true,
          url: 'https://example.org/hls/audio.m3u8',
        },
        {
          name: 'Alternate tones',
          language: 'fa',
          default: false,
          url: 'https://example.org/hls/alternate.m3u8',
        },
      ],
    });
    for (const invalid of [
      text.replace('alternate.m3u8', 'http://127.0.0.1/private'),
      text.replace('NAME="Alternate tones"', 'NAME="Original tones"'),
      text.replace('AUDIO="stereo"', 'AUDIO="missing"'),
    ])
      expect(() => parseHls(invalid, base)).toThrow();
  });
  it('resolves a completed MP4 VOD plan and real quality/audio choices', () => {
    const parsed = parseHls(vod, base);
    expect(parsed.kind).toBe('media');
    if (parsed.kind !== 'media') throw Error('Expected media');
    expect(parsed.parts).toHaveLength(4);
    expect(parsed.duration).toBeCloseTo(4.0832, 5);
    expect(parsed.init?.url).toBe('https://example.org/hls/init.mp4');
    const master = parseHls(
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="Original tones",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=200000,CODECS="avc1.42E01E,mp4a.40.2",AUDIO="stereo"\nvideo.m3u8\n',
      base,
    );
    expect(master).toMatchObject({
      kind: 'master',
      variants: [
        { externalAudio: true, bandwidth: 200000, url: 'https://example.org/hls/video.m3u8' },
      ],
    });
  });
  it('handles exact byte ranges and refuses unsafe, unsupported encrypted, live and discontinuous inputs', () => {
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
  it('resolves AES-128 key rotation, explicit and sequence IVs and clear transitions', () => {
    const parsed = parseHls(
      vod
        .replace('#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-MEDIA-SEQUENCE:257')
        .replace('#EXT-X-MAP:', '#EXT-X-KEY:METHOD=AES-128,URI="key-a",IV=0x1\n#EXT-X-MAP:')
        .replace('#EXTINF:', '#EXT-X-KEY:METHOD=AES-128,URI="key-b"\n#EXTINF:')
        .replace('part-1.m4s', '#EXT-X-KEY:METHOD=NONE\npart-1.m4s'),
      base,
    );
    if (parsed.kind !== 'media') throw Error('Expected media');
    expect(parsed.init?.encryption).toEqual({
      url: 'https://example.org/hls/key-a',
      iv: '00000000000000000000000000000001',
    });
    expect(parsed.parts[0]?.encryption).toEqual({
      url: 'https://example.org/hls/key-b',
      iv: '00000000000000000000000000000101',
    });
    expect(parsed.parts[1]?.encryption).toBeUndefined();
    for (const attrs of [
      'METHOD=SAMPLE-AES,URI="key"',
      'METHOD=AES-128,URI="key",KEYFORMAT="com.apple.streamingkeydelivery"',
      'METHOD=AES-128,URI="key",KEYFORMAT=""',
      'METHOD=AES-128,URI="key",KEYFORMATVERSIONS=""',
      'METHOD=AES-128,URI="key",IV=0x100000000000000000000000000000000',
      'METHOD=AES-128,URI="http://127.0.0.1/key"',
      'METHOD=NONE,URI="key"',
    ])
      expect(() =>
        parseHls(vod.replace('#EXT-X-MAP:', `#EXT-X-KEY:${attrs}\n#EXT-X-MAP:`), base),
      ).toThrow();
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
  it('refuses fields that cross their own box boundary and edit-list timelines', async () => {
    const init = await readFile(new URL('../fixtures/media/init.mp4', import.meta.url));
    const tracks = inspectMp4Init(init);
    const box = (type: string, payload: Uint8Array) => {
      const result = Buffer.alloc(8 + payload.length);
      result.writeUInt32BE(result.length);
      result.write(type, 4, 'ascii');
      result.set(payload, 8);
      return result;
    };
    const tfhd = Buffer.alloc(8);
    tfhd.writeUInt32BE(0x20000);
    tfhd.writeUInt32BE(tracks[0]!.id, 4);
    const run = Buffer.alloc(12);
    run.writeUInt32BE(1);
    run.writeUInt32BE(1, 4);
    const truncated = box(
      'moof',
      box(
        'traf',
        Buffer.concat([box('tfhd', tfhd), box('tfdt', Buffer.alloc(4)), box('trun', run)]),
      ),
    );
    expect(() => inspectMoof(truncated, tracks)).toThrow(/Truncated MP4 tfdt/);
    const edited = Buffer.from(init),
      moov = mp4Boxes(edited).find((item) => item.type === 'moov')!;
    const trak = mp4Boxes(edited, moov.body, moov.end).find((item) => item.type === 'trak')!;
    const header = mp4Boxes(edited, trak.body, trak.end).find((item) => item.type === 'tkhd')!;
    edited.write('edts', header.start + 4, 'ascii');
    expect(() => inspectMp4Init(edited)).toThrow(/edit lists/);
    expect(() => mp4Boxes(init, -1)).toThrow(/boundary/);
  });
});
