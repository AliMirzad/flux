import { validateUrl } from '../../shared/security';
export interface HlsEncryption {
  url: string;
  iv: string;
}
export interface HlsPart {
  epoch?: number;
  presentationOffset?: number;
  sourceOffset?: number;
  initialization?: HlsPart;
  url: string;
  range?: { start: number; end: number };
  duration?: number;
  encryption?: HlsEncryption;
}
export interface HlsVariant {
  url: string;
  bandwidth: number;
  resolution?: string;
  codecs?: string;
  externalAudio: boolean;
  audioGroup?: string;
}
export interface HlsAudio {
  group: string;
  name: string;
  language?: string;
  url?: string;
  default: boolean;
}
export type HlsManifest =
  | { kind: 'master'; variants: HlsVariant[]; audio: HlsAudio[] }
  | {
      kind: 'media';
      init?: HlsPart;
      transport: 'mp4' | 'mpegts';
      parts: HlsPart[];
      sequence: number;
      duration: number;
      live?: boolean;
      targetDuration?: number;
      presentationStart?: number;
    };
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
export function parseHls(
  text: string,
  base: string,
  allowLocal = false,
  allowLive = false,
): HlsManifest {
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
  let key: { url: string; iv?: string } | undefined,
    sessionKey = false,
    sequenceSeen = false;
  const parseKey = (value: string, session = false) => {
    const attrs = attributes(value);
    if (attrs.METHOD === 'NONE' && !session) {
      if (Object.keys(attrs).length !== 1)
        throw new Error('HLS METHOD=NONE cannot have key attributes.');
      return undefined;
    }
    if (
      attrs.METHOD !== 'AES-128' ||
      (attrs.KEYFORMAT !== undefined && attrs.KEYFORMAT !== 'identity') ||
      (attrs.KEYFORMATVERSIONS !== undefined &&
        (!/^[1-9]\d*(?:\/[1-9]\d*)*$/.test(attrs.KEYFORMATVERSIONS) ||
          !attrs.KEYFORMATVERSIONS.split('/').includes('1')))
    )
      throw new Error(
        'Only ordinary identity AES-128 HLS keys are supported. DRM and sample encryption are not supported.',
      );
    if (!attrs.URI) throw new Error('The HLS AES-128 key address is missing.');
    if (attrs.IV !== undefined && !/^0[xX][0-9a-fA-F]{1,32}$/.test(attrs.IV))
      throw new Error('The HLS AES-128 IV must be a 128-bit hexadecimal integer.');
    return {
      url: resolve(attrs.URI),
      ...(attrs.IV === undefined ? {} : { iv: attrs.IV.slice(2).padStart(32, '0').toLowerCase() }),
    };
  };
  const audioChoices: HlsAudio[] = [];
  let pendingVariant: Record<string, string> | undefined;
  const variantGroups: string[] = [];
  let init: HlsPart | undefined,
    currentInit: HlsPart | undefined,
    nextInit: HlsPart | undefined,
    epoch = 0,
    epochBoundary = false,
    elapsed = 0,
    discontinuitySequenceSeen = false,
    duration: number | undefined,
    range: string | undefined,
    sequence = 0,
    ended = false,
    targetDuration: number | undefined;
  const parts: HlsPart[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-KEY:')) {
      key = parseKey(line.slice(11));
    } else if (line.startsWith('#EXT-X-SESSION-KEY:')) {
      parseKey(line.slice(19), true);
      sessionKey = true;
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = attributes(line.slice(13));
      if (attrs.TYPE === 'AUDIO') {
        if (
          !attrs['GROUP-ID'] ||
          attrs['GROUP-ID'].length > 256 ||
          !attrs.NAME ||
          attrs.NAME.length > 256 ||
          (attrs.LANGUAGE?.length ?? 0) > 63 ||
          (attrs.DEFAULT !== undefined && !['YES', 'NO'].includes(attrs.DEFAULT)) ||
          (attrs.AUTOSELECT !== undefined && !['YES', 'NO'].includes(attrs.AUTOSELECT)) ||
          (attrs.DEFAULT === 'YES' && attrs.AUTOSELECT === 'NO') ||
          audioChoices.some(
            (choice) =>
              choice.group === attrs['GROUP-ID'] &&
              (choice.name === attrs.NAME || (choice.default && attrs.DEFAULT === 'YES')),
          )
        )
          throw new Error('Invalid or duplicate HLS audio rendition.');
        audioChoices.push({
          group: attrs['GROUP-ID'],
          name: attrs.NAME,
          default: attrs.DEFAULT === 'YES',
          ...(attrs.URI ? { url: resolve(attrs.URI) } : {}),
          ...(attrs.LANGUAGE ? { language: attrs.LANGUAGE } : {}),
        });
        if (audioChoices.length > 1000) throw new Error('Too many HLS audio renditions.');
      }
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      if (pendingVariant) throw new Error('HLS variant is missing its playlist address.');
      pendingVariant = attributes(line.slice(18));
    } else if (line.startsWith('#EXT-X-MAP:')) {
      if (parts.length && !init)
        throw new Error('HLS initialization must precede its media segments.');
      const attrs = attributes(line.slice(11));
      if (!attrs.URI) throw new Error('HLS initialization address is missing.');
      if (key && !key.iv)
        throw new Error('An encrypted HLS initialization section requires an explicit IV.');
      const next = {
        url: resolve(attrs.URI),
        ...(key ? { encryption: { url: key.url, iv: key.iv! } } : {}),
        ...(attrs.BYTERANGE ? { range: byteRange(attrs.BYTERANGE) } : {}),
      };
      if (init && JSON.stringify(currentInit) !== JSON.stringify(next) && !epochBoundary)
        throw new Error('Changing HLS initialization requires a declared discontinuity.');
      init ??= next;
      if (epochBoundary && JSON.stringify(currentInit) !== JSON.stringify(next)) nextInit = next;
      currentInit = next;
    } else if (line.startsWith('#EXTINF:')) {
      if (duration !== undefined) throw new Error('HLS segment address is missing.');
      duration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
        throw new Error('Invalid HLS segment duration.');
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) range = line.slice(17);
    else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      if (sequenceSeen || parts.length)
        throw new Error('The HLS media sequence must occur once before its segments.');
      sequence = integer(line.slice(22));
      sequenceSeen = true;
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = integer(line.slice(22), false);
      if (targetDuration > 86400) throw new Error('Invalid HLS target duration.');
    } else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) {
      if (parts.length || discontinuitySequenceSeen || epochBoundary)
        throw new Error('Invalid HLS discontinuity sequence placement.');
      epoch = integer(line.slice(30));
      discontinuitySequenceSeen = true;
    } else if (line === '#EXT-X-DISCONTINUITY') {
      if (duration !== undefined || !Number.isSafeInteger(++epoch))
        throw new Error('Invalid HLS discontinuity boundary.');
      epochBoundary = true;
    } else if (line === '#EXT-X-ENDLIST') ended = true;
    else if (
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
        if (!Number.isSafeInteger(sequence + parts.length))
          throw new Error('The HLS media sequence exceeds its supported integer range.');
        parts.push({
          url,
          duration,
          ...(epoch ? { epoch } : {}),
          ...(epochBoundary ? { presentationOffset: elapsed } : {}),
          ...(nextInit ? { initialization: nextInit } : {}),
          ...(key
            ? {
                encryption: {
                  url: key.url,
                  iv:
                    key.iv ??
                    BigInt(sequence + parts.length)
                      .toString(16)
                      .padStart(32, '0'),
                },
              }
            : {}),
          ...(range
            ? { range: byteRange(range, previous?.url === url ? previous.range : undefined) }
            : {}),
        });
        elapsed += duration;
        epochBoundary = false;
        nextInit = undefined;
        duration = undefined;
        range = undefined;
        if (parts.length > maxMediaParts) throw new Error('Too many HLS segments.');
      }
    }
  }
  if (pendingVariant || duration !== undefined || range || epochBoundary)
    throw new Error('The HLS playlist is incomplete.');
  if (
    variantGroups.some((group) => group && !audioChoices.some((choice) => choice.group === group))
  )
    throw new Error('The HLS quality refers to a missing audio group.');
  if (variants.length)
    return {
      kind: 'master',
      variants: variants.map((variant, index) => ({
        ...variant,
        externalAudio: audioChoices.some(
          (choice) => choice.group === variantGroups[index] && !!choice.url,
        ),
        ...(variantGroups[index] ? { audioGroup: variantGroups[index] } : {}),
      })),
      audio: audioChoices,
    };
  if (sessionKey) throw new Error('HLS session keys belong in a master playlist.');
  if (!ended && !allowLive)
    throw new Error(
      'A live HLS stream needs a finite recording workflow. Select a completed VOD playlist.',
    );
  if (!parts.length) throw new Error('The HLS playlist contains no media segments.');
  const total = parts.reduce((sum, part) => sum + part.duration!, 0);
  if (!Number.isFinite(total) || total > 7 * 86400)
    throw new Error('The HLS duration exceeds the supported finite plan.');
  return {
    kind: 'media',
    init,
    transport: init ? 'mp4' : 'mpegts',
    parts,
    sequence,
    duration: total,
    ...(!ended
      ? {
          live: true,
          targetDuration:
            targetDuration ?? Math.ceil(Math.max(...parts.map((part) => part.duration!))),
        }
      : {}),
  };
}
