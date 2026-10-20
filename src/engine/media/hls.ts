import { validateUrl } from '../../shared/security';
export interface HlsPart {
  url: string;
  range?: { start: number; end: number };
  duration?: number;
}
export interface HlsVariant {
  url: string;
  bandwidth: number;
  resolution?: string;
  codecs?: string;
  externalAudio: boolean;
}
export type HlsManifest =
  | { kind: 'master'; variants: HlsVariant[] }
  | { kind: 'media'; init: HlsPart; parts: HlsPart[]; sequence: number; duration: number };
export const maxManifestBytes = 4 * 1024 * 1024;
export const maxMediaParts = 32768;

function attributes(value: string) {
  const result: Record<string, string> = {};
  let cursor = 0;
  while (cursor < value.length) {
    const key = value.slice(cursor).match(/^([A-Z0-9-]+)=/);
    if (!key || result[key[1]!] !== undefined)
      throw new Error('Malformed or duplicate HLS attribute.');
    cursor += key[0].length;
    let text: string;
    if (value[cursor] === '"') {
      const end = value.indexOf('"', cursor + 1);
      if (end < 0) throw new Error('Unterminated HLS attribute.');
      text = value.slice(cursor + 1, end);
      cursor = end + 1;
    } else {
      const end = value.indexOf(',', cursor);
      text = value.slice(cursor, end < 0 ? undefined : end);
      cursor = end < 0 ? value.length : end;
    }
    result[key[1]!] = text;
    if (cursor < value.length && value[cursor++] !== ',')
      throw new Error('Malformed HLS attribute separator.');
  }
  return result;
}
function integer(value: string, allowZero = true) {
  if (!/^\d+$/.test(value)) throw new Error('Invalid HLS integer.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1)) throw new Error('Unsafe HLS integer.');
  return n;
}
function byteRange(value: string, previous?: HlsPart['range']) {
  const match = value.match(/^(\d+)(?:@(\d+))?$/);
  if (!match) throw new Error('Invalid HLS byte range.');
  const length = integer(match[1]!, false);
  const start = match[2] !== undefined ? integer(match[2]) : previous ? previous.end + 1 : NaN;
  const end = start + length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
    throw new Error('HLS byte range needs a safe explicit initial offset.');
  return { start, end };
}
export function parseHls(text: string, base: string, allowLocal = false): HlsManifest {
  if (text.length > maxManifestBytes)
    throw new Error('HLS playlist exceeds the supported manifest size.');
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('The response is not an HLS playlist.');
  const source = validateUrl(base, allowLocal);
  const resolve = (value: string) => {
    if (value.includes('{$'))
      throw new Error('HLS variable substitution requires a separate supported workflow.');
    const target = validateUrl(new URL(value, source).href, allowLocal);
    if (source.protocol === 'https:' && target.protocol === 'http:')
      throw new Error('An insecure HLS child address was blocked.');
    return target.href;
  };
  const variants: HlsVariant[] = [];
  const audioGroups = new Set<string>();
  let pendingVariant: Record<string, string> | undefined;
  const variantGroups: string[] = [];
  let init: HlsPart | undefined,
    duration: number | undefined,
    range: string | undefined,
    sequence = 0,
    ended = false;
  const parts: HlsPart[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) {
      if (attributes(line.slice(line.indexOf(':') + 1)).METHOD !== 'NONE')
        throw new Error(
          'Encrypted HLS requires an explicit key workflow that is not supported yet.',
        );
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = attributes(line.slice(13));
      if (attrs.TYPE === 'AUDIO' && attrs.URI && attrs['GROUP-ID'])
        audioGroups.add(attrs['GROUP-ID']);
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      if (pendingVariant) throw new Error('HLS variant is missing its playlist address.');
      pendingVariant = attributes(line.slice(18));
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = attributes(line.slice(11));
      if (!attrs.URI) throw new Error('HLS initialization address is missing.');
      const next = {
        url: resolve(attrs.URI),
        ...(attrs.BYTERANGE ? { range: byteRange(attrs.BYTERANGE) } : {}),
      };
      if (init && JSON.stringify(init) !== JSON.stringify(next))
        throw new Error(
          'Changing HLS initialization sections needs a remux workflow that is not supported yet.',
        );
      init = next;
    } else if (line.startsWith('#EXTINF:')) {
      if (duration !== undefined) throw new Error('HLS segment address is missing.');
      duration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
        throw new Error('Invalid HLS segment duration.');
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) range = line.slice(17);
    else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = integer(line.slice(22));
    else if (line === '#EXT-X-ENDLIST') ended = true;
    else if (
      line === '#EXT-X-DISCONTINUITY' ||
      line === '#EXT-X-GAP' ||
      line === '#EXT-X-I-FRAMES-ONLY' ||
      line.startsWith('#EXT-X-SKIP:')
    )
      throw new Error(
        'This HLS discontinuity, gap, partial list or I-frame-only stream needs a separate supported workflow.',
      );
    else if (!line.startsWith('#')) {
      if (ended) throw new Error('HLS data follows the playlist end marker.');
      if (pendingVariant) {
        if (parts.length || init)
          throw new Error('Mixed HLS master and media playlists are invalid.');
        variants.push({
          url: resolve(line),
          bandwidth: integer(pendingVariant.BANDWIDTH ?? '', false),
          resolution: pendingVariant.RESOLUTION,
          codecs: pendingVariant.CODECS,
          externalAudio: false,
        });
        variantGroups.push(pendingVariant.AUDIO ?? '');
        pendingVariant = undefined;
        if (variants.length > 1000) throw new Error('Too many HLS variants.');
      } else {
        if (duration === undefined || variants.length)
          throw new Error('Unexpected HLS segment address.');
        const url = resolve(line),
          previous = parts.at(-1);
        parts.push({
          url,
          duration,
          ...(range
            ? { range: byteRange(range, previous?.url === url ? previous.range : undefined) }
            : {}),
        });
        duration = undefined;
        range = undefined;
        if (parts.length > maxMediaParts) throw new Error('Too many HLS segments.');
      }
    }
  }
  if (pendingVariant || duration !== undefined || range)
    throw new Error('The HLS playlist is incomplete.');
  if (variants.length)
    return {
      kind: 'master',
      variants: variants.map((variant, index) => ({
        ...variant,
        externalAudio: audioGroups.has(variantGroups[index]!),
      })),
    };
  if (!ended)
    throw new Error(
      'A live HLS stream needs a finite recording workflow. Select a completed VOD playlist.',
    );
  if (!parts.length) throw new Error('The HLS playlist contains no media segments.');
  if (!init)
    throw new Error(
      'This HLS transport needs a transmuxer. Select an MP4 HLS rendition with an initialization section.',
    );
  const total = parts.reduce((sum, part) => sum + part.duration!, 0);
  if (!Number.isFinite(total) || total > 7 * 86400)
    throw new Error('The HLS duration exceeds the supported finite plan.');
  return { kind: 'media', init, parts, sequence, duration: total };
}
