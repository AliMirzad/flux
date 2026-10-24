import { readFile } from 'node:fs/promises';

/** Own synthetic fragmented media, packaged independently as DASH templates, lists and SIDX. */
export async function addDashFixtures(media: Map<string, Buffer>) {
  const proof = JSON.parse(
    await readFile(new URL('./media/split/proof.json', import.meta.url), 'utf8'),
  ) as { durations: { video: number[]; audio: number[] } };
  const durations = (kind: string) => proof.durations[kind === 'video' ? 'video' : 'audio'];
  const scale = (kind: string) => (kind === 'video' ? 30000 : 48000);
  const timeline = (kind: string, offset = false) =>
    `<SegmentTimeline>${durations(kind)
      .map(
        (duration, index) =>
          `<S ${index === 0 ? `t="${offset ? scale(kind) * (kind === 'video' ? 100 : 200) : 0}" ` : ''}d="${Math.round(duration * scale(kind))}"/>`,
      )
      .join('')}</SegmentTimeline>`;
  for (const kind of ['video', 'audio', 'alternate']) {
    const fragments = [0, 1, 2, 3].map((index) => media.get(`split/${kind}-${index}.m4s`)!);
    const initialization = media.get(`split/${kind}-init.mp4`)!;
    const sidx = Buffer.alloc(32 + fragments.length * 12);
    sidx.writeUInt32BE(sidx.length, 0);
    sidx.write('sidx', 4);
    sidx.writeUInt32BE(1, 12);
    sidx.writeUInt32BE(scale(kind), 16);
    sidx.writeUInt16BE(fragments.length, 30);
    let time = 0;
    for (const [index, fragment] of fragments.entries()) {
      sidx.writeUInt32BE(fragment.length, 32 + index * 12);
      sidx.writeUInt32BE(Math.round(durations(kind)[index]! * scale(kind)), 36 + index * 12);
      sidx.writeUInt32BE(0x90000000, 40 + index * 12);
      media.set(`split/${kind}-time-${time}.m4s`, fragment);
      const shifted = Buffer.from(fragment),
        tfdt = shifted.indexOf('tfdt');
      if (tfdt < 0) throw new Error('Fixture fragment lacks tfdt');
      const delta = scale(kind) * (kind === 'video' ? 100 : 200);
      if (shifted[tfdt + 4] === 1)
        shifted.writeBigUInt64BE(shifted.readBigUInt64BE(tfdt + 8) + BigInt(delta), tfdt + 8);
      else shifted.writeUInt32BE(shifted.readUInt32BE(tfdt + 8) + delta, tfdt + 8);
      media.set(`split/offset-${kind}-${index}.m4s`, shifted);
      time += Math.round(durations(kind)[index]! * scale(kind));
    }
    media.set(`split/${kind}-indexed.mp4`, Buffer.concat([initialization, sidx, ...fragments]));
  }
  for (const mode of ['number', 'time', 'list', 'index', 'offset']) {
    const representation = (kind: string) => {
      let address: string;
      const initialization = media.get(`split/${kind}-init.mp4`)!;
      if (mode === 'index')
        address = `<BaseURL>${kind}-indexed.mp4</BaseURL><SegmentBase indexRange="${initialization.length}-${initialization.length + 79}"><Initialization range="0-${initialization.length - 1}"/></SegmentBase>`;
      else if (mode === 'list')
        address = `<SegmentList timescale="${scale(kind)}"><Initialization sourceURL="${kind}-init.mp4"/>${timeline(kind)}${[0, 1, 2, 3].map((index) => `<SegmentURL media="${kind}-${index}.m4s"/>`).join('')}</SegmentList>`;
      else
        address = `<SegmentTemplate timescale="${scale(kind)}" startNumber="0" ${mode === 'offset' ? `presentationTimeOffset="${scale(kind) * (kind === 'video' ? 100 : 200)}" ` : ''}initialization="$RepresentationID$-init.mp4" media="${mode === 'offset' ? 'offset-' : ''}$RepresentationID$-${mode === 'time' ? 'time-$Time$' : '$Number$'}.m4s">${timeline(kind, mode === 'offset')}</SegmentTemplate>`;
      return `<Representation id="${kind}" bandwidth="${kind === 'video' ? 500000 : 64000}" ${kind === 'alternate' ? 'lang="fa"' : ''}>${address}</Representation>`;
    };
    media.set(
      `split/dash-${mode}.mpd`,
      Buffer.from(
        `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4.0832S"><Period><AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.42E01E" width="160" height="90">${representation('video')}</AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2" lang="en">${representation('audio')}${representation('alternate')}</AdaptationSet></Period></MPD>`,
      ),
    );
    const single = media.get(`split/dash-${mode}.mpd`)!.toString();
    const period = single
      .slice(single.indexOf('<Period>'), single.indexOf('</Period>') + 9)
      .replace('<Period>', '<Period duration="PT4.0832S">');
    media.set(
      `split/dash-multi-${mode}.mpd`,
      Buffer.from(
        single
          .replace('mediaPresentationDuration="PT4.0832S"', 'mediaPresentationDuration="PT8.1664S"')
          .replace(
            /<Period>.*<\/Period>/,
            period + period.replace('<Period duration=', '<Period start="PT4.0832S" duration='),
          ),
      ),
    );
  }
}
