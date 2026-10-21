export interface Box {
  type: string;
  start: number;
  size: number;
  body: number;
  end: number;
}
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const ascii = (data: Uint8Array, at: number, length = 4) =>
  String.fromCharCode(...data.subarray(at, at + length));
function u32(data: Uint8Array, at: number) {
  if (at < 0 || at + 4 > data.length) throw new Error('Truncated MP4 metadata.');
  return view(data).getUint32(at);
}
function u64(data: Uint8Array, at: number) {
  if (at < 0 || at + 8 > data.length) throw new Error('Truncated MP4 metadata.');
  const n = Number(view(data).getBigUint64(at));
  if (!Number.isSafeInteger(n)) throw new Error('Unsafe MP4 size or timeline.');
  return n;
}
function fields(box: Box, bytes: number) {
  if (box.end - box.body < bytes) throw new Error(`Truncated MP4 ${box.type} fields.`);
}
export function mp4Boxes(data: Uint8Array, start = 0, end = data.length): Box[] {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > data.length
  )
    throw new Error('Invalid MP4 container boundary.');
  const result: Box[] = [];
  for (let at = start; at < end;) {
    if (at + 8 > end) throw new Error('Truncated MP4 box header.');
    const n = u32(data, at),
      size = n === 1 ? u64(data, at + 8) : n,
      header = n === 1 ? 16 : 8;
    if (size < header || !Number.isSafeInteger(at + size) || at + size > end)
      throw new Error('Invalid MP4 box boundary.');
    result.push({ type: ascii(data, at + 4), start: at, size, body: at + header, end: at + size });
    if (result.length > 100000) throw new Error('Too many MP4 boxes.');
    at += size;
  }
  return result;
}
function child(data: Uint8Array, parent: Box, type: string) {
  const all = mp4Boxes(data, parent.body, parent.end).filter((box) => box.type === type);
  if (all.length !== 1) throw new Error(`MP4 requires exactly one ${type} box.`);
  return all[0]!;
}
export interface Mp4Track {
  id: number;
  timescale: number;
  kind: 'video' | 'audio';
  codec: string;
  defaultDuration: number;
  defaultSize: number;
}
export function inspectMp4Init(data: Uint8Array): Mp4Track[] {
  if (data.length > 1048576) throw new Error('MP4 initialization metadata exceeds 1 MiB.');
  const top = mp4Boxes(data);
  if (
    top.filter((box) => box.type === 'ftyp').length !== 1 ||
    top.some((box) => !['ftyp', 'moov', 'free', 'skip'].includes(box.type))
  )
    throw new Error('Invalid MP4 initialization section.');
  const root = { type: 'root', start: 0, body: 0, end: data.length, size: data.length };
  const moov = child(data, root, 'moov');
  if (mp4Boxes(data, moov.body, moov.end).some((box) => box.type === 'pssh'))
    throw new Error('Protected MP4 tracks are not supported.');
  const mvex = child(data, moov, 'mvex');
  const defaults = new Map<number, { duration: number; size: number }>();
  for (const box of mp4Boxes(data, mvex.body, mvex.end).filter((box) => box.type === 'trex')) {
    fields(box, 24);
    if (
      u32(data, box.body) !== 0 ||
      u32(data, box.body + 8) !== 1 ||
      defaults.has(u32(data, box.body + 4))
    )
      throw new Error('Unsupported MP4 fragment defaults.');
    defaults.set(u32(data, box.body + 4), {
      duration: u32(data, box.body + 12),
      size: u32(data, box.body + 16),
    });
  }
  const tracks: Mp4Track[] = [];
  for (const trak of mp4Boxes(data, moov.body, moov.end).filter((box) => box.type === 'trak')) {
    if (mp4Boxes(data, trak.body, trak.end).some((box) => box.type === 'edts'))
      throw new Error('MP4 edit lists require a supported timeline remux workflow.');
    const tkhd = child(data, trak, 'tkhd'),
      version = data[tkhd.body];
    if (version !== 0 && version !== 1) throw new Error('Unsupported MP4 track header.');
    fields(tkhd, version === 1 ? 32 : 24);
    const id = u32(data, tkhd.body + (version === 1 ? 20 : 12));
    const mdia = child(data, trak, 'mdia'),
      mdhd = child(data, mdia, 'mdhd'),
      handler = child(data, mdia, 'hdlr');
    const timeVersion = data[mdhd.body];
    if (timeVersion !== 0 && timeVersion !== 1) throw new Error('Unsupported MP4 media header.');
    fields(mdhd, timeVersion === 1 ? 32 : 20);
    fields(handler, 12);
    const timescale = u32(data, mdhd.body + (timeVersion === 1 ? 20 : 12));
    const kind = ascii(data, handler.body + 8);
    if (kind !== 'vide' && kind !== 'soun')
      throw new Error('This MP4 track type needs a supported mux workflow.');
    const stsd = child(data, child(data, child(data, mdia, 'minf'), 'stbl'), 'stsd');
    fields(stsd, 8);
    if (u32(data, stsd.body + 4) !== 1)
      throw new Error('Changing MP4 sample descriptions are not supported yet.');
    const entries = mp4Boxes(data, stsd.body + 8, stsd.end),
      entry = entries[0];
    if (
      entries.length !== 1 ||
      !entry ||
      !(kind === 'vide' ? ['avc1', 'avc3'] : ['mp4a']).includes(entry.type)
    )
      throw new Error(
        'Select an H.264/AAC MP4 HLS rendition. Other codecs require separate validation.',
      );
    const nested = entry.start + (kind === 'vide' ? 86 : 36);
    if (
      nested > entry.end ||
      mp4Boxes(data, nested, entry.end).some((box) => ['sinf', 'tenc', 'schm'].includes(box.type))
    )
      throw new Error('Protected or unsupported MP4 sample metadata.');
    if (!id || !timescale || tracks.some((track) => track.id === id))
      throw new Error('Invalid MP4 track identity or timescale.');
    const fallback = defaults.get(id);
    if (!fallback) throw new Error('MP4 fragment defaults are missing.');
    tracks.push({
      id,
      timescale,
      kind: kind === 'vide' ? 'video' : 'audio',
      codec: entry.type,
      defaultDuration: fallback.duration,
      defaultSize: fallback.size,
    });
  }
  if (!tracks.length || tracks.length > 2)
    throw new Error('Select a single video/audio MP4 rendition.');
  return tracks;
}
export interface FragmentTrack {
  id: number;
  base: number;
  duration: number;
  samples: number;
  timePosition: number;
  timeVersion: number;
  bytes: number;
  dataOffset: number;
}
/** Reads bounded moof metadata; the mdat payload is validated in the staged file. */
export function inspectMoof(data: Uint8Array, tracks: Mp4Track[]): FragmentTrack[] {
  if (data.length > 1048576) throw new Error('MP4 fragment metadata exceeds 1 MiB.');
  const top = mp4Boxes(data);
  if (top.length !== 1 || top[0]?.type !== 'moof') throw new Error('Invalid MP4 movie fragment.');
  const result: FragmentTrack[] = [];
  for (const traf of mp4Boxes(data, top[0].body, top[0].end).filter((box) => box.type === 'traf')) {
    const children = mp4Boxes(data, traf.body, traf.end);
    if (children.some((box) => ['senc', 'saiz', 'saio', 'uuid'].includes(box.type)))
      throw new Error('Protected MP4 fragment metadata is not supported.');
    const tfhd = child(data, traf, 'tfhd');
    fields(tfhd, 8);
    const flags = u32(data, tfhd.body) & 0xffffff,
      id = u32(data, tfhd.body + 4);
    const track = tracks.find((track) => track.id === id);
    if (
      !track ||
      result.some((item) => item.id === id) ||
      flags & 1 ||
      !(flags & 0x20000) ||
      flags & 0x10000 ||
      u32(data, tfhd.body) >>> 24 !== 0 ||
      flags & ~0x3003b
    )
      throw new Error('Unsupported MP4 track or absolute fragment addressing.');
    const optionalBytes = [2, 8, 16, 32].filter((flag) => flags & flag).length * 4;
    fields(tfhd, 8 + optionalBytes);
    let cursor = tfhd.body + 8;
    if (flags & 2) {
      if (u32(data, cursor) !== 1) throw new Error('Changing MP4 sample description.');
      cursor += 4;
    }
    const defaultDuration = flags & 8 ? u32(data, cursor) : track.defaultDuration;
    if (flags & 8) cursor += 4;
    const defaultSize = flags & 16 ? u32(data, cursor) : track.defaultSize;
    if (flags & 16) cursor += 4;
    if (flags & 32) cursor += 4;
    if (cursor !== tfhd.end) throw new Error('Malformed MP4 fragment defaults.');
    const tfdt = child(data, traf, 'tfdt'),
      timeVersion = data[tfdt.body]!;
    if (timeVersion !== 0 && timeVersion !== 1) throw new Error('Unsupported MP4 decode time.');
    fields(tfdt, timeVersion === 1 ? 12 : 8);
    if (tfdt.end - tfdt.body !== (timeVersion === 1 ? 12 : 8) || u32(data, tfdt.body) & 0xffffff)
      throw new Error('Malformed MP4 decode time.');
    const timePosition = tfdt.body + 4,
      base = timeVersion === 1 ? u64(data, timePosition) : u32(data, timePosition);
    const runs = children.filter((box) => box.type === 'trun');
    if (runs.length !== 1)
      throw new Error('Select MP4 fragments with one contiguous run per track.');
    const run = runs[0]!;
    fields(run, 12);
    const runFlags = u32(data, run.body) & 0xffffff,
      samples = u32(data, run.body + 4);
    if (
      !samples ||
      !(runFlags & 1) ||
      data[run.body]! > 1 ||
      runFlags & ~0xf05 ||
      (runFlags & 4 && runFlags & 0x400)
    )
      throw new Error('MP4 run has no samples or relative data offset.');
    const dataOffset = view(data).getInt32(run.body + 8);
    let position = run.body + 12;
    if (runFlags & 4) position += 4;
    const perSample = [0x100, 0x200, 0x400, 0x800].filter((flag) => runFlags & flag).length * 4;
    if (position + samples * perSample !== run.end) throw new Error('Malformed MP4 sample table.');
    let duration = 0,
      bytes = 0;
    if (!perSample) {
      duration = defaultDuration * samples;
      bytes = defaultSize * samples;
    } else
      for (let sample = 0; sample < samples; sample++) {
        duration += runFlags & 0x100 ? u32(data, position) : defaultDuration;
        if (runFlags & 0x100) position += 4;
        bytes += runFlags & 0x200 ? u32(data, position) : defaultSize;
        if (runFlags & 0x200) position += 4;
        if (runFlags & 0x400) position += 4;
        if (runFlags & 0x800) position += 4;
      }
    if (
      !Number.isSafeInteger(duration) ||
      duration <= 0 ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      !Number.isSafeInteger(base + duration)
    )
      throw new Error('Unsafe MP4 sample sizes or duration.');
    result.push({ id, base, duration, samples, timePosition, timeVersion, bytes, dataOffset });
  }
  if (!result.length) throw new Error('MP4 fragment contains no media tracks.');
  return result;
}
