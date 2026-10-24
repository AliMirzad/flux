import { parseXml, XmlElement } from '@rgrove/parse-xml';
import { validateUrl } from '../../shared/security';
import type { HlsPart, HlsManifest } from './hls';
import { maxManifestBytes, maxMediaParts } from './hls';

export type MediaPlan = Extract<HlsManifest, { kind: 'media' }>;
export interface DashSelection {
  videoId: string;
  audioId?: string;
}
export interface DashChoice {
  id: string;
  kind: 'video' | 'audio';
  bandwidth: number;
  width?: number;
  height?: number;
  language?: string;
  codecs?: string;
}
export interface DashRepresentation extends DashChoice {
  periodStart?: number;
  periodDuration?: number;
  periods?: DashRepresentation[];
  offset: number;
  plan?: MediaPlan;
  index?: { url: string; range: { start: number; end: number }; init: HlsPart };
}
export interface DashManifest {
  live?: boolean;
  minimumUpdatePeriod?: number;
  duration: number;
  representations: DashRepresentation[];
}
export interface DashReview {
  live?: boolean;
  kind: 'dash';
  url: string;
  choices: DashChoice[];
  selection: DashSelection;
  duration: number;
  parts: number;
  origins: string[];
}
const namespace = 'urn:mpeg:dash:schema:mpd:2011';
const fail = (message: string): never => {
  throw new Error(message);
};
function numeric(value: string | undefined, fallback?: number, zero = true): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^\d+$/.test(value)) return fail('Invalid DASH integer.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (zero ? 0 : 1)) return fail('Unsafe DASH integer.');
  return number;
}
export function dashDuration(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || !match.slice(1).some((part) => part !== undefined))
    return fail('Invalid DASH duration.');
  const seconds =
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 7 * 86400)
    return fail('DASH duration exceeds seven days.');
  return seconds;
}
function ns(node: XmlElement) {
  const prefix = node.name.includes(':') ? node.name.split(':')[0]! : '';
  const key = prefix ? 'xmlns:' + prefix : 'xmlns';
  for (
    let current: XmlElement | undefined = node;
    current;
    current = current.parent instanceof XmlElement ? current.parent : undefined
  )
    if (current.attributes[key] !== undefined) return current.attributes[key];
  return '';
}
function children(node: XmlElement, name: string) {
  return node.children.filter(
    (item): item is XmlElement =>
      item instanceof XmlElement && item.name.split(':').pop() === name && ns(item) === namespace,
  );
}
function one(node: XmlElement, name: string) {
  const entries = children(node, name);
  if (entries.length > 1) return fail('Ambiguous DASH ' + name + ' element.');
  return entries[0];
}
function range(value: string): { start: number; end: number } {
  const match = /^(\d+)-(\d+)$/.exec(value);
  if (!match) return fail('Invalid DASH byte range.');
  const start = numeric(match[1]),
    end = numeric(match[2]);
  if (end < start || !Number.isSafeInteger(end - start + 1)) return fail('Unsafe DASH byte range.');
  return { start, end };
}
function template(value: string, id: string, bandwidth: number, number?: number, time?: number) {
  if (value.replace(/\$\$|\$[^$]+\$/g, '').includes('$'))
    return fail('Unclosed DASH template token.');
  // Replace escaped dollars and tokens in one pass; representation IDs are never reparsed as templates.
  return value.replace(/\$\$|\$([^$]+)\$/g, (token: string, field: string | undefined) => {
    if (token === '$$') return '$';
    const match = /^(RepresentationID|Bandwidth|Number|Time)(?:%0([1-9]\d?)d)?$/.exec(field!);
    if (!match) return fail('Unsupported DASH address template.');
    const target =
      match[1] === 'RepresentationID'
        ? id
        : match[1] === 'Bandwidth'
          ? bandwidth
          : match[1] === 'Number'
            ? number
            : time;
    if (target === undefined || (match[2] && match[1] === 'RepresentationID'))
      return fail('Invalid DASH template substitution.');
    return String(target).padStart(Number(match[2] ?? 0), '0');
  });
}
interface Interval {
  time: number;
  duration: number;
  ordinal: number;
}
function intervals(
  attrs: Record<string, string>,
  timeline: XmlElement | undefined,
  duration: number,
  count?: number,
  windowStart?: number,
): Interval[] {
  const scale = numeric(attrs.timescale, 1, false),
    offset = numeric(attrs.presentationTimeOffset, 0);
  const bound = offset + Math.floor(duration * scale),
    lower = offset + Math.floor((windowStart ?? 0) * scale);
  if (!Number.isSafeInteger(bound)) return fail('Unsafe DASH timeline bound.');
  const output: Interval[] = [];
  let cursor = 0,
    ordinal = 0;
  const append = (time: number, length: number) => {
    if (!Number.isSafeInteger(time + length)) return fail('Unsafe DASH segment timing.');
    if (
      time + length > Math.max(offset, lower) &&
      (windowStart === undefined ? time < bound : time + length <= bound)
    ) {
      if (time < offset) return fail('DASH leading preroll needs an explicit trimming workflow.');
      output.push({ time, duration: length / scale, ordinal });
      if (output.length > maxMediaParts) return fail('Too many DASH media segments.');
    }
    ordinal++;
  };
  if (timeline) {
    const entries = children(timeline, 'S');
    if (!entries.length || entries.length > maxMediaParts)
      return fail('Invalid DASH SegmentTimeline.');
    for (const [index, entry] of entries.entries()) {
      const attrs = entry.attributes,
        start = numeric(attrs.t, cursor),
        length = numeric(attrs.d, undefined, false);
      if (index && start !== cursor)
        return fail('A DASH timeline gap or overlap requires discontinuity handling.');
      let repeat = attrs.r === '-1' ? -1 : numeric(attrs.r, 0);
      if (repeat === -1) {
        const next = entries[index + 1]?.attributes.t;
        const end = next === undefined ? bound : numeric(next);
        if (end <= start || (next !== undefined && (end - start) % length !== 0))
          return fail('Invalid DASH open repeat boundary.');
        repeat = Math.ceil((end - start) / length) - 1;
      }
      if (
        windowStart === undefined &&
        (repeat > maxMediaParts || ordinal + repeat + 1 > maxMediaParts)
      )
        return fail('DASH timeline expansion exceeds its segment limit.');
      const skip =
        windowStart === undefined
          ? 0
          : Math.max(0, Math.min(repeat + 1, Math.floor((lower - start) / length)));
      const through =
        windowStart === undefined
          ? repeat
          : Math.min(repeat, Math.floor((bound - start) / length) - 1);
      ordinal += skip;
      for (let i = skip; i <= through; i++) append(start + i * length, length);
      ordinal += repeat + 1 - Math.max(skip, through + 1);
      cursor = start + (repeat + 1) * length;
    }
  } else {
    const length = numeric(attrs.duration, undefined, false);
    const first = Math.max(Math.floor(offset / length), Math.floor(lower / length)),
      total = count ?? Math.ceil(bound / length);
    if ((windowStart === undefined ? total : total - first) > maxMediaParts || total <= first)
      return fail('DASH segment count is outside its supported bound.');
    ordinal = first;
    for (let i = first; i < total; i++) append(i * length, length);
  }
  if (timeline && count !== undefined && ordinal !== count)
    return fail('DASH SegmentTimeline and SegmentURL counts differ.');
  if (!output.length) return fail('DASH presentation contains no media segments.');
  const end = output.at(-1)!;
  if (
    windowStart === undefined &&
    Math.abs(end.time / scale + end.duration - offset / scale - duration) > 1
  )
    return fail('DASH segment timing does not cover the selected period.');
  return output;
}
export function parseDash(
  text: string,
  base: string,
  allowLocal = false,
  liveNow?: number,
): DashManifest {
  if (text.length > maxManifestBytes || (text.match(/</g)?.length ?? 0) > 131072)
    return fail('DASH manifest exceeds its parsing bound.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    return fail('DASH document types and custom entities are not allowed.');
  let root: XmlElement;
  try {
    root = parseXml(text).root!;
  } catch {
    return fail('Malformed DASH XML.');
  }
  if (!root || root.name.split(':').pop() !== 'MPD' || ns(root) !== namespace)
    return fail('The response is not a DASH MPD.');
  // The parser is iterative. Bound depth and total nodes before any recursive namespace/timing work.
  const pending: { node: XmlElement; depth: number }[] = [{ node: root, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++nodes > 65536 || depth > 64) return fail('DASH XML tree exceeds its structural bound.');
    if (Object.keys(node.attributes).some((key) => key.endsWith(':href')))
      return fail('External DASH XML links are not supported.');
    for (const child of node.children)
      if (child instanceof XmlElement) pending.push({ node: child, depth: depth + 1 });
  }
  const dynamic = root.attributes.type === 'dynamic';
  if (
    (root.attributes.type !== undefined && !['static', 'dynamic'].includes(root.attributes.type)) ||
    (dynamic && liveNow === undefined)
  )
    return fail('Dynamic DASH recording is not supported. Select a completed static MPD.');
  const periods = children(root, 'Period');
  if (!periods.length || periods.length > 128)
    return fail('DASH period count exceeds its supported bound.');
  const overall = dashDuration(root.attributes.mediaPresentationDuration);
  if (dynamic) {
    if (periods.length !== 1) return fail('Dynamic DASH currently requires one active period.');
    const availability = Date.parse(root.attributes.availabilityStartTime ?? '');
    const published = root.attributes.publishTime
      ? Date.parse(root.attributes.publishTime)
      : liveNow!;
    if (
      !Number.isFinite(availability) ||
      !Number.isFinite(published) ||
      published > liveNow! + 300000 ||
      published <= availability
    )
      return fail('Dynamic DASH requires a valid availability clock.');
    const start = dashDuration(periods[0]!.attributes.start) ?? 0;
    const delay = dashDuration(root.attributes.suggestedPresentationDelay) ?? 0;
    const elapsed = (published - availability) / 1000 - start - delay;
    const depth = dashDuration(root.attributes.timeShiftBufferDepth) ?? 60;
    if (elapsed <= 0 || !Number.isFinite(elapsed) || depth <= 0 || depth > 600 || delay > 60)
      return fail('Unsupported DASH live window or presentation delay.');
    const result = parsePeriod(
      root,
      periods[0]!,
      elapsed,
      base,
      allowLocal,
      { parts: 0, addresses: 0 },
      Math.max(0, elapsed - depth),
    );
    result.live = true;
    result.minimumUpdatePeriod = Math.max(
      0.25,
      Math.min(30, dashDuration(root.attributes.minimumUpdatePeriod) ?? 2),
    );
    result.duration = Math.max(
      ...result.representations.flatMap((item) => (item.plan ? [item.plan.duration] : [])),
    );
    return result;
  }
  let duration = 0;
  const budget = { parts: 0, addresses: 0 };
  const parsed: DashManifest[] = [];
  for (const [index, period] of periods.entries()) {
    const start = dashDuration(period.attributes.start) ?? duration;
    if (Math.abs(start - duration) > 0.000001)
      return fail('DASH periods must be contiguous and start at zero.');
    const next = periods[index + 1];
    const length =
      dashDuration(period.attributes.duration) ??
      (next?.attributes.start
        ? dashDuration(next.attributes.start)! - start
        : overall === undefined
          ? undefined
          : overall - start);
    if (!length || length <= 0) return fail('A finite DASH period duration is required.');
    const result = parsePeriod(root, period, length, base, allowLocal, budget);
    for (const representation of result.representations) {
      representation.periodStart = start;
      representation.periodDuration = length;
    }
    parsed.push(result);
    duration += length;
    if (duration > 7 * 86400) return fail('DASH presentation exceeds seven days.');
  }
  if (overall !== undefined && Math.abs(duration - overall) > 0.001)
    return fail('DASH periods do not cover the declared duration.');
  if (parsed.length === 1) return parsed[0]!;
  const representations = parsed[0]!.representations.flatMap((first) => {
    const members = parsed.map((item) =>
      item.representations.find(
        (candidate) => candidate.id === first.id && candidate.kind === first.kind,
      ),
    );
    if (members.some((item) => !item)) return [];
    const { plan: unusedPlan, index: unusedIndex, ...choice } = first;
    return [{ ...choice, periods: members as DashRepresentation[] }];
  });
  if (!representations.some((item) => item.kind === 'video'))
    return fail('No video representation is available across all DASH periods.');
  return { duration, representations };
}
function parsePeriod(
  root: XmlElement,
  period: XmlElement,
  duration: number,
  base: string,
  allowLocal: boolean,
  budget: { parts: number; addresses: number },
  windowStart?: number,
): DashManifest {
  const source = validateUrl(base, allowLocal);

  const accountAddress = (url: string) => {
    budget.addresses += url.length;
    if (budget.addresses > 8 * 1024 * 1024)
      return fail('Expanded DASH addresses exceed the 8 MiB metadata budget.');
    return url;
  };
  const resolve = (value: string, from: string) => {
    if (!value || /[\x00-\x1f\x7f]/.test(value)) return fail('Invalid DASH resource address.');
    const target = validateUrl(new URL(value, from).href, allowLocal);
    if (source.protocol === 'https:' && target.protocol !== 'https:')
      return fail('An insecure DASH child address was blocked.');
    return target.href;
  };
  const representations: DashRepresentation[] = [];
  for (const [adaptationIndex, adaptation] of children(period, 'AdaptationSet').entries()) {
    for (const representation of children(adaptation, 'Representation')) {
      if (representations.length >= 1000) return fail('Too many DASH representations.');
      const hierarchy = [root, period, adaptation, representation];
      if (
        hierarchy.some(
          (node) =>
            children(node, 'ContentProtection').length ||
            children(node, 'EssentialProperty').length,
        )
      )
        continue;
      const inherited = Object.assign(
        Object.create(null) as Record<string, string>,
        ...hierarchy.map((node) => node.attributes),
      );
      const kind = inherited.contentType ?? inherited.mimeType?.split('/')[0];
      if (kind !== 'video' && kind !== 'audio') continue;
      if (inherited.mimeType !== undefined && inherited.mimeType !== kind + '/mp4') continue;
      if (
        inherited.codecs &&
        !(kind === 'video' ? /^avc[13]\./ : /^mp4a\.40\./).test(inherited.codecs)
      )
        continue;
      const rawId = representation.attributes.id;
      if (!rawId || rawId.length > 256 || /[\x00-\x1f\x7f]/.test(rawId))
        return fail('DASH representation ID is missing or invalid.');
      const id = adaptationIndex + '/' + rawId;
      if (representations.some((item) => item.id === id))
        return fail('Duplicate DASH representation ID.');
      const bandwidth = numeric(inherited.bandwidth, undefined, false);
      let address = source.href,
        mode = '',
        attrs: Record<string, string> = Object.create(null);
      let timeline: XmlElement | undefined,
        initialization: XmlElement | undefined,
        urls: XmlElement[] = [];
      for (const node of hierarchy) {
        if (node.attributes['xml:base']) address = resolve(node.attributes['xml:base'], address);
        const bases = children(node, 'BaseURL');
        if (bases.length) address = resolve(bases[0]!.text.trim(), address);
        const addresses = ['SegmentTemplate', 'SegmentList', 'SegmentBase'].flatMap((name) =>
          children(node, name).map((value) => ({ name, value })),
        );
        if (addresses.length > 1) return fail('Ambiguous DASH segment addressing.');
        const entry = addresses[0];
        if (!entry) continue;
        if (mode !== entry.name) {
          attrs = Object.create(null);
          timeline = undefined;
          initialization = undefined;
          urls = [];
        }
        mode = entry.name;
        Object.assign(attrs, entry.value.attributes);
        timeline = one(entry.value, 'SegmentTimeline') ?? timeline;
        initialization = one(entry.value, 'Initialization') ?? initialization;
        const ownUrls = children(entry.value, 'SegmentURL');
        if (ownUrls.length) urls = ownUrls;
      }
      const scale = numeric(attrs.timescale, 1, false),
        offset = numeric(attrs.presentationTimeOffset, 0) / scale;
      const choice: DashRepresentation = {
        id,
        kind,
        bandwidth,
        offset,
        ...(inherited.width ? { width: numeric(inherited.width, undefined, false) } : {}),
        ...(inherited.height ? { height: numeric(inherited.height, undefined, false) } : {}),
        ...(inherited.lang ? { language: inherited.lang.slice(0, 63) } : {}),
        ...(inherited.codecs ? { codecs: inherited.codecs.slice(0, 256) } : {}),
      };
      let init: HlsPart;
      if (mode === 'SegmentTemplate') {
        if (!attrs.initialization || !attrs.media)
          return fail('DASH initialization and media templates are required.');
        init = { url: resolve(template(attrs.initialization, rawId, bandwidth), address) };
      } else {
        if (!initialization) return fail('DASH initialization metadata is required.');
        init = {
          url: initialization.attributes.sourceURL
            ? resolve(initialization.attributes.sourceURL, address)
            : address,
          ...(initialization.attributes.range
            ? { range: range(initialization.attributes.range) }
            : {}),
        };
      }
      accountAddress(init.url);
      if (mode === 'SegmentBase') {
        if (windowStart !== undefined)
          return fail('Live DASH requires explicit segment templates or lists.');
        if (!attrs.indexRange) return fail('DASH indexed addressing requires an index byte range.');
        const indexRange = range(attrs.indexRange);
        if (indexRange.end - indexRange.start + 1 > 1048576)
          return fail('DASH index exceeds 1 MiB.');
        choice.index = { url: address, range: indexRange, init };
      } else {
        if (mode !== 'SegmentTemplate' && mode !== 'SegmentList')
          return fail('Missing DASH segment addresses.');
        const schedule = intervals(
          attrs,
          timeline,
          duration,
          mode === 'SegmentList' ? urls.length : undefined,
          windowStart,
        );
        const first = numeric(attrs.startNumber, 1),
          last = attrs.endNumber === undefined ? undefined : numeric(attrs.endNumber);
        const parts = schedule.map((entry): HlsPart => {
          if (++budget.parts > maxMediaParts)
            return fail('Expanded DASH plans exceed the total segment budget.');
          const number = first + entry.ordinal;
          if (!Number.isSafeInteger(number) || (last !== undefined && number > last))
            return fail('DASH segment numbering does not cover the presentation.');
          if (mode === 'SegmentTemplate')
            return {
              url: accountAddress(
                resolve(template(attrs.media!, rawId, bandwidth, number, entry.time), address),
              ),
              duration: entry.duration,
            };
          const item = urls[entry.ordinal];
          if (!item || item.attributes.index || item.attributes.indexRange)
            return fail('Unsupported or missing DASH SegmentURL.');
          return {
            url: accountAddress(
              item.attributes.media ? resolve(item.attributes.media, address) : address,
            ),
            duration: entry.duration,
            ...(item.attributes.mediaRange ? { range: range(item.attributes.mediaRange) } : {}),
          };
        });
        choice.plan = {
          kind: 'media',
          transport: 'mp4',
          init,
          parts,
          sequence: first + schedule[0]!.ordinal,
          ...(windowStart !== undefined
            ? {
                live: true,
                presentationStart: schedule[0]!.time / scale - offset,
                targetDuration: Math.max(...parts.map((part) => part.duration!)),
              }
            : {}),
          duration: parts.reduce((sum, part) => sum + part.duration!, 0),
        };
      }
      representations.push(choice);
    }
  }
  if (!representations.some((item) => item.kind === 'video'))
    return fail('No supported unprotected H.264 DASH video representation was found.');
  return { duration, representations };
}

/** Expand direct SIDX references. Offsets are relative to the end of the actual sidx box. */
export function dashIndex(
  bytes: Uint8Array,
  rangeStart: number,
  source: DashRepresentation,
): MediaPlan {
  if (!source.index || bytes.length > 1048576) return fail('Invalid DASH index metadata.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at + 8 <= bytes.length;) {
    const size = view.getUint32(at),
      name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (size < 8 || at + size > bytes.length) return fail('Truncated DASH index box.');
    if (name !== 'sidx') {
      at += size;
      continue;
    }
    const version = bytes[at + 8];
    if (
      (version !== 0 && version !== 1) ||
      size < (version ? 40 : 32) ||
      view.getUint32(at + 8) & 0xffffff
    )
      return fail('Invalid DASH SIDX header.');
    const scale = view.getUint32(at + 16);
    let cursor = at + 20;
    const value = () => {
      const number = version ? Number(view.getBigUint64(cursor)) : view.getUint32(cursor);
      cursor += version ? 8 : 4;
      return number;
    };
    const earliest = value(),
      relative = value();
    cursor += 2;
    const count = view.getUint16(cursor);
    cursor += 2;
    if (source.index.url.length * count > 8 * 1024 * 1024)
      return fail('Expanded DASH index addresses exceed the 8 MiB metadata budget.');
    if (
      !scale ||
      !Number.isSafeInteger(earliest) ||
      !Number.isSafeInteger(relative) ||
      !count ||
      count > maxMediaParts ||
      cursor + count * 12 !== at + size ||
      Math.abs(earliest / scale - source.offset) > 0.25
    )
      return fail('DASH SIDX timeline or reference count is invalid.');
    let offset = rangeStart + at + size + relative;
    const parts: HlsPart[] = [];
    for (let index = 0; index < count; index++, cursor += 12) {
      const reference = view.getUint32(cursor),
        length = reference & 0x7fffffff,
        ticks = view.getUint32(cursor + 4);
      if (reference & 0x80000000 || !length || !ticks || !Number.isSafeInteger(offset + length))
        return fail('Hierarchical or invalid DASH SIDX reference.');
      parts.push({
        url: source.index.url,
        range: { start: offset, end: offset + length - 1 },
        duration: ticks / scale,
      });
      offset += length;
    }
    return {
      kind: 'media',
      transport: 'mp4',
      init: source.index.init,
      parts,
      sequence: 0,
      duration: parts.reduce((sum, part) => sum + part.duration!, 0),
    };
  }
  return fail('DASH index contains no SIDX box.');
}
