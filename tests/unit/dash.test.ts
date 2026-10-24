import { describe, expect, it } from 'vitest';
import { parseDash, dashDuration, dashIndex } from '../../src/engine/media/dash';
const root = (body: string, attrs = 'mediaPresentationDuration="PT4S"') =>
  `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" ${attrs}><Period>${body}</Period></MPD>`;
const video = (address: string, attrs = '') =>
  `<AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.42E01E"><Representation id="v" bandwidth="100000" ${attrs}>${address}</Representation></AdaptationSet>`;
const address =
  '<SegmentTemplate timescale="1000" duration="2000" initialization="init-$RepresentationID$.mp4" media="part-$Number%05d$-$Bandwidth$.m4s"/>';
const base = 'https://media.example/movie/main.mpd';
describe('bounded DASH MPD planning', () => {
  it('expands inherited number templates and resolves nested bases and escaped XML', () => {
    const input = root(
      `<BaseURL>../assets/</BaseURL><SegmentTemplate timescale="1000" duration="2000" initialization="init.mp4"/><AdaptationSet contentType="video" mimeType="video/mp4"><BaseURL>video/</BaseURL><Representation id="v" bandwidth="100000"><SegmentTemplate startNumber="7" media="part-$Number%05d$-$Bandwidth$.m4s?x=1&amp;y=2"/></Representation></AdaptationSet>`,
    );
    const representation = parseDash(input, base).representations[0]!;
    expect(representation.plan!.init!.url).toBe('https://media.example/assets/video/init.mp4');
    expect(representation.plan!.parts.map((part) => part.url)).toEqual(
      [7, 8].map(
        (number) =>
          `https://media.example/assets/video/part-${String(number).padStart(5, '0')}-100000.m4s?x=1&y=2`,
      ),
    );
    expect(representation.plan!.duration).toBe(4);
  });
  it('expands time addressing, presentation offsets and a finite negative repeat', () => {
    const source = root(
      video(
        '<SegmentTemplate timescale="1000" presentationTimeOffset="5000" initialization="init.mp4" media="part-$Time$.m4s"><SegmentTimeline><S t="5000" d="1000" r="-1"/></SegmentTimeline></SegmentTemplate>',
      ),
    );
    const parsed = parseDash(source, base).representations[0]!;
    expect(parsed.offset).toBe(5);
    expect(parsed.plan!.parts.map((part) => part.url)).toEqual(
      [5000, 6000, 7000, 8000].map((time) => `https://media.example/movie/part-${time}.m4s`),
    );
  });
  it('accepts prefixed DASH elements and explicit SegmentList ranges', () => {
    const source = root(
      video(
        '<SegmentList timescale="10" duration="20"><Initialization sourceURL="all.mp4" range="0-99"/><SegmentURL media="all.mp4" mediaRange="100-199"/><SegmentURL media="all.mp4" mediaRange="200-399"/></SegmentList>',
      ),
    );
    const prefixed = source
      .replace('xmlns=', 'xmlns:d=')
      .replace(
        /<(\/?)(MPD|Period|AdaptationSet|Representation|SegmentList|Initialization|SegmentURL)(?=[\s>])/g,
        '<$1d:$2',
      );
    const plan = parseDash(prefixed, base).representations[0]!.plan!;
    expect(plan.init!.range).toEqual({ start: 0, end: 99 });
    expect(plan.parts[1]!.range).toEqual({ start: 200, end: 399 });
  });
  it.each([
    root(video(address), 'type="dynamic" mediaPresentationDuration="PT4S"'),
    root(video(address)).replace('PT4S', 'PT999999999999S'),
    root(video(address.replace('2000', '1'))).replace('PT4S', 'P7D'),
    root(video(address.replace('part-$Number%05d$-$Bandwidth$', 'part-$Unknown$'))),
    root(video(address.replace('part-$Number%05d$-$Bandwidth$', 'part-$Number'))),
    root(video(address.replace('init-$RepresentationID$.mp4', 'http://127.0.0.1/private'))),
    root(video(address.replace('init-$RepresentationID$.mp4', 'http://media.example/init.mp4'))),
    root(
      video(
        address.replace(
          'init-$RepresentationID$.mp4',
          'https://user:secret@media.example/init.mp4',
        ),
      ),
    ),
    root(video(address.replace('duration="2000"', 'duration="0"'))),
    root(video(address.replace('duration="2000"', 'duration="9007199254740992"'))),
    root(video(address)).replace('</Period>', '</Period><Period/>'),
    root(video(address)).replace('<Period>', '<Period start="PT1S">'),
    root(
      video(
        '<SegmentTemplate initialization="init.mp4" media="$Time$.m4s"><SegmentTimeline><S t="0" d="1"/><S t="3" d="1"/></SegmentTimeline></SegmentTemplate>',
      ),
    ),
    root(video(address)).replace(
      '<Representation ',
      '<Representation xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://another.example/mpd" ',
    ),
    '<!DOCTYPE MPD [<!ENTITY x "test">]>' + root(video(address)),
  ])('refuses unsupported or unsafe declarations before any media request', (source) => {
    expect(() => parseDash(source, base)).toThrow();
  });
  it('never exposes malformed XML excerpts or expands custom entities', () => {
    expect(() => parseDash('<MPD secret="private-token">', base)).toThrow('Malformed DASH XML.');
    const source = root(video(address)).replace('init-$RepresentationID$.mp4', '&custom;');
    expect(() => parseDash(source, base)).toThrow('Malformed DASH XML.');
  });
  it('skips protected representations and refuses a protected-only presentation', () => {
    const protectedVideo = video(
      '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"/>' + address,
    );
    expect(() => parseDash(root(protectedVideo), base)).toThrow(/unprotected/);
    const mixed = root(protectedVideo + video(address));
    expect(parseDash(mixed, base).representations).toHaveLength(1);
  });
  it('bounds XML depth and validates ISO durations', () => {
    expect(dashDuration('P1DT2H3M4.5S')).toBe(93784.5);
    expect(() => dashDuration('P1M')).toThrow();
    expect(() =>
      parseDash(root('<x>'.repeat(65) + '</x>'.repeat(65) + video(address)), base),
    ).toThrow(/structural/);
  });
  it('bounds a dynamic template window using the availability clock without expanding all earlier segments', () => {
    const now = Date.parse('2026-10-24T00:00:00Z');
    const source = root(
      video('<SegmentTemplate duration="2" initialization="init.mp4" media="$Number$.m4s"/>'),
      'type="dynamic" availabilityStartTime="2025-10-24T00:00:00Z" publishTime="2026-10-24T00:00:00Z" timeShiftBufferDepth="PT6S"',
    );
    const result = parseDash(source, base, false, now);
    expect(result.live).toBe(true);
    expect(result.representations[0]!.plan!.parts).toHaveLength(3);
    expect(result.representations[0]!.plan!.sequence).toBeGreaterThan(1000000);
    expect(() => parseDash(source.replace('PT6S', 'PT601S'), base, false, now)).toThrow(
      /live window/,
    );
  });
  it('bounds aggregate representation expansion and repeated long addresses before materializing huge plans', () => {
    const repeated =
      '<AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate timescale="1000" duration="1" initialization="init.mp4" media="$Number$.m4s"/>' +
      Array.from(
        { length: 9 },
        (_, index) => '<Representation id="v' + index + '" bandwidth="1000"/>',
      ).join('') +
      '</AdaptationSet>';
    expect(() => parseDash(root(repeated), base)).toThrow(/total segment budget/);
    const long =
      '<BaseURL>https://cdn.example.com/' +
      'x'.repeat(10000) +
      '/</BaseURL>' +
      video(
        '<SegmentTemplate timescale="1000" duration="1" initialization="init.mp4" media="$Number$.m4s"/>',
      );
    expect(() => parseDash(root(long), base)).toThrow(/metadata budget/);
  });
  it('resolves direct SIDX references and rejects hierarchical indexes', () => {
    const index = new Uint8Array(44),
      view = new DataView(index.buffer);
    view.setUint32(0, 44);
    index.set([115, 105, 100, 120], 4);
    view.setUint32(16, 1000);
    view.setUint16(30, 1);
    view.setUint32(32, 500);
    view.setUint32(36, 4000);
    const source = {
      id: '0/v',
      kind: 'video' as const,
      bandwidth: 100,
      offset: 0,
      index: {
        url: base,
        range: { start: 100, end: 143 },
        init: { url: base, range: { start: 0, end: 99 } },
      },
    };
    expect(dashIndex(index, 100, source).parts).toEqual([
      { url: base, range: { start: 144, end: 643 }, duration: 4 },
    ]);
    view.setUint32(32, 0x80000100);
    expect(() => dashIndex(index, 100, source)).toThrow(/Hierarchical/);
  });
});
