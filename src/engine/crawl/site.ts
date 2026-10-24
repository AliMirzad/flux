import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { validateUrl, safeError } from '../../shared/security';
import { filenameFromHeaders, sanitizeFilename } from '../../shared/files';
import { HttpError } from '../network/http';
import { mediaRequest, readMediaBody, type MediaNetwork } from '../media/network';
import { sleep } from '../speed/control';
import { robotsPolicy } from './robots';
import { TrafficLimitError } from '../speed/budget';
export interface CrawlNetwork extends MediaNetwork {
  checkAllowance?: (signal: AbortSignal) => Promise<void>;
  consume?: (bytes: number, signal: AbortSignal) => Promise<void>;
}
export interface CrawlOptions {
  depth: number;
  maxPages: number;
  maxResults: number;
  maxBytes: number;
  delayMs: number;
  stayInFolder: boolean;
  includePages: boolean;
  includeAssets: boolean;
  useBrowserCookies: boolean;
}
export const defaultCrawlOptions: CrawlOptions = {
  depth: 2,
  maxPages: 20,
  maxResults: 500,
  maxBytes: 20 * 1024 * 1024,
  delayMs: 250,
  stayInFolder: true,
  includePages: false,
  includeAssets: true,
  useBrowserCookies: false,
};
export interface CrawlItem {
  url: string;
  filename: string;
  kind: 'page' | 'file';
}
export interface CrawlProgress {
  pages: number;
  bytes: number;
  found: number;
  current?: string;
}
export interface CrawlResult {
  items: CrawlItem[];
  errors: { url: string; error: string }[];
  pages: number;
  bytes: number;
  skipped: number;
  limited: boolean;
  stopped: boolean;
}
export function validateCrawlOptions(options: CrawlOptions) {
  const bounded = (value: number, min: number, max: number) =>
    Number.isSafeInteger(value) && value >= min && value <= max;
  if (
    !options ||
    !bounded(options.depth, 0, 5) ||
    !bounded(options.maxPages, 1, 100) ||
    !bounded(options.maxResults, 1, 500) ||
    !bounded(options.maxBytes, 1024, 64 * 1024 * 1024) ||
    !bounded(options.delayMs, 200, 10000) ||
    ['stayInFolder', 'includePages', 'includeAssets', 'useBrowserCookies'].some(
      (key) => typeof options[key as keyof CrawlOptions] !== 'boolean',
    )
  )
    throw new Error('Invalid crawler limits or preferences.');
}
type Node = DefaultTreeAdapterMap['node'];
/** No browser DOM is constructed: scripts, frames and resource URLs cannot execute or load. */
export function pageReferences(html: string, pageUrl: string, allowLocal = false) {
  if (html.length > 1048576 || (html.match(/</g)?.length ?? 0) > 32768)
    throw new Error('Page exceeds the crawler parsing bound.');
  const tree = parse(html),
    pending: Node[] = [tree];
  const nodes: DefaultTreeAdapterMap['element'][] = [];
  let count = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++count > 65536) throw new Error('Page exceeds the crawler node limit.');
    if ('tagName' in node) nodes.push(node);
    if ('childNodes' in node)
      for (let index = node.childNodes.length - 1; index >= 0; index--)
        pending.push(node.childNodes[index]!);
  }
  const attribute = (node: DefaultTreeAdapterMap['element'], key: string) =>
    node.attrs.find((item) => item.name === key)?.value;
  let base = pageUrl;
  const baseElement = nodes.find((node) => node.tagName === 'base' && attribute(node, 'href'));
  if (baseElement)
    try {
      base = new URL(attribute(baseElement, 'href')!, pageUrl).href;
    } catch {
      /* The browser also ignores an invalid base. */
    }
  const nofollow = nodes.some(
    (node) =>
      node.tagName === 'meta' &&
      /^(robots|flux)$/i.test(attribute(node, 'name') ?? '') &&
      /\bnofollow\b/i.test(attribute(node, 'content') ?? ''),
  );
  const references: {
    url: string;
    filename?: string;
    page: boolean;
    follow: boolean;
    embedded: boolean;
  }[] = [];
  let skipped = 0;
  for (const node of nodes) {
    const anchor = ['a', 'area'].includes(node.tagName),
      asset = [
        'img',
        'source',
        'audio',
        'video',
        'script',
        'link',
        'track',
        'embed',
        'input',
      ].includes(node.tagName);
    if (!anchor && !asset) continue;
    if (
      node.tagName === 'link' &&
      !/\b(stylesheet|icon|preload)\b/i.test(attribute(node, 'rel') ?? '')
    )
      continue;
    const raw = attribute(node, anchor || node.tagName === 'link' ? 'href' : 'src');
    if (!raw || raw.startsWith('#')) continue;
    try {
      const url = validateUrl(new URL(raw, base).href, allowLocal);
      if (new URL(pageUrl).protocol === 'https:' && url.protocol !== 'https:') {
        skipped++;
        continue;
      }
      const explicit = node.attrs.some((item) => item.name === 'download');
      const page =
        anchor &&
        !explicit &&
        (!/\.[a-z\d]{1,10}$/i.test(url.pathname) ||
          /\.(?:html?|xhtml|php|aspx?|jsp)$/i.test(url.pathname));
      const follow =
        page &&
        !nofollow &&
        !/\bnofollow\b/i.test(attribute(node, 'rel') ?? '') &&
        !/(?:^|\/)(?:logout|signout|delete|remove|unsubscribe)(?:\/|\.|$)/i.test(url.pathname);
      references.push({
        url: url.href,
        filename: attribute(node, 'download') || undefined,
        page,
        follow,
        embedded: asset,
      });
      if (references.length >= 5000) {
        skipped++;
        break;
      }
    } catch {
      skipped++;
    }
  }
  return { references, skipped };
}
export async function crawlSite(
  raw: string,
  options: CrawlOptions,
  network: CrawlNetwork,
  progress: (value: CrawlProgress) => void = () => {},
) {
  validateCrawlOptions(options);
  const root = validateUrl(raw, network.allowLocalForTests);
  const prefix = root.pathname.endsWith('/')
    ? root.pathname
    : root.pathname.slice(0, root.pathname.lastIndexOf('/') + 1);
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), 300000);
  const signal = AbortSignal.any([network.signal, deadline.signal]);
  const output: CrawlResult = {
    items: [],
    errors: [],
    pages: 0,
    bytes: 0,
    skipped: 0,
    limited: false,
    stopped: false,
  };
  let robots: (path: string) => boolean = () => true,
    lastRequest = 0;
  const scoped: MediaNetwork = {
    ...network,
    signal,
    redirectPolicy: {
      credentialOrigin: options.useBrowserCookies ? root.origin : undefined,
      prepareRequest: async (url, abort) => {
        const target = validateUrl(url, network.allowLocalForTests);
        if (
          target.origin !== root.origin ||
          (target.pathname !== '/robots.txt' &&
            options.stayInFolder &&
            !target.pathname.startsWith(prefix))
        )
          throw new Error('The crawler stays inside the selected site and folder.');
        if (!robots(target.pathname + target.search))
          throw new Error('The website robots policy excludes this address.');
        await network.redirectPolicy?.prepareRequest?.(url, abort);
      },
      resolveRedirect: async (from, location, abort) => {
        const next = network.redirectPolicy
          ? await network.redirectPolicy.resolveRedirect(from, location, abort)
          : location
            ? new URL(location, from).href
            : null;
        if (!next) throw new Error('The crawler could not resolve this redirect.');
        const target = validateUrl(next, network.allowLocalForTests);
        if (target.origin !== root.origin)
          throw new Error('The crawler does not follow redirects to another site.');
        return target.href;
      },
    },
  };
  const request = async (url: string) => {
    await network.checkAllowance?.(signal);
    const remaining = options.delayMs - (performance.now() - lastRequest);
    if (remaining > 0) await sleep(remaining, signal);
    lastRequest = performance.now();
    return mediaRequest(url, {}, scoped);
  };
  const text = async (response: Response, maximum: number) => {
    const decoder = new TextDecoder('utf-8'),
      pieces: string[] = [];
    let length = 0;
    await readMediaBody(response, signal, async (chunk) => {
      length += chunk.length;
      output.bytes += chunk.length;
      await network.consume?.(chunk.length, signal);
      if (length > maximum || output.bytes > options.maxBytes) {
        output.limited = true;
        throw new Error('The crawler page or total byte limit was reached.');
      }
      pieces.push(decoder.decode(chunk, { stream: true }));
    });
    pieces.push(decoder.decode());
    return pieces.join('');
  };
  const seen = new Set<string>(),
    queued = new Set<string>([root.href]),
    found = new Set<string>();
  const queue = [{ url: root.href, depth: 0 }];
  let resultCharacters = 0;
  const add = (url: string, kind: 'page' | 'file', filename?: string) => {
    if (found.has(url)) return;
    if (
      output.items.length >= options.maxResults ||
      resultCharacters + url.length + (filename?.length ?? 256) > 1048576
    ) {
      output.limited = true;
      return;
    }
    resultCharacters += url.length + (filename?.length ?? 256);
    found.add(url);
    output.items.push({
      url,
      kind,
      filename: filename ? sanitizeFilename(filename) : filenameFromHeaders(null, url),
    });
  };
  try {
    try {
      const response = await request(root.origin + '/robots.txt');
      robots = robotsPolicy(await text(response, 512 * 1024));
    } catch (error) {
      if (!(error instanceof HttpError && [404, 410].includes(error.status))) throw error;
    }
    while (
      queue.length &&
      !signal.aborted &&
      output.pages < options.maxPages &&
      output.bytes < options.maxBytes
    ) {
      const next = queue.shift()!;
      if (seen.has(next.url)) continue;
      seen.add(next.url);
      if (!robots(new URL(next.url).pathname + new URL(next.url).search)) {
        output.skipped++;
        continue;
      }
      output.pages++;
      progress({
        pages: output.pages,
        bytes: output.bytes,
        found: output.items.length,
        current: next.url,
      });
      let response: Response | undefined;
      try {
        response = await request(next.url);
        const type = response.headers.get('content-type') ?? '';
        if (
          !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type) ||
          /^attachment\b/i.test(response.headers.get('content-disposition') ?? '')
        ) {
          add(
            next.url,
            'file',
            filenameFromHeaders(response.headers.get('content-disposition'), next.url),
          );
          continue;
        }
        const actual = response.url || next.url;
        if (options.includePages) add(actual, 'page');
        const page = pageReferences(
          await text(response, 1048576),
          actual,
          network.allowLocalForTests,
        );
        output.skipped += page.skipped;
        for (const reference of page.references) {
          const target = new URL(reference.url);
          if (target.origin === root.origin && !robots(target.pathname + target.search)) {
            output.skipped++;
            continue;
          }
          if (!reference.page || options.includePages) {
            if (reference.embedded && !options.includeAssets) continue;
            add(reference.url, reference.page ? 'page' : 'file', reference.filename);
          }
          if (
            !reference.follow ||
            next.depth >= options.depth ||
            target.origin !== root.origin ||
            (options.stayInFolder && !target.pathname.startsWith(prefix)) ||
            queued.has(reference.url)
          )
            continue;
          if (queued.size >= options.maxPages) {
            output.limited = true;
            continue;
          }
          queued.add(reference.url);
          queue.push({ url: reference.url, depth: next.depth + 1 });
        }
      } catch (error) {
        if (signal.aborted) break;
        if (output.errors.length < 100)
          output.errors.push({ url: next.url, error: safeError(error) });
        if (error instanceof TrafficLimitError) {
          output.limited = true;
          break;
        }
      } finally {
        await response?.body?.cancel().catch(() => undefined);
      }
    }
    output.limited ||= !!queue.length || deadline.signal.aborted;
    output.stopped = network.signal.aborted;
    progress({ pages: output.pages, bytes: output.bytes, found: output.items.length });
    return output;
  } catch (error) {
    if (signal.aborted) {
      output.stopped = network.signal.aborted;
      output.limited = deadline.signal.aborted;
      return output;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
