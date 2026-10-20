import type { Resource } from '../../domain/model';
import { validateUrl } from '../../shared/security';
import { filenameFromHeaders } from '../../shared/files';
import { parseContentRange } from '../segmentation/ranges';
import { checkAbort, sleep } from '../speed/control';
import type { RedirectPolicy } from './policy';
export class HttpError extends Error {
  constructor(
    public status: number,
    public retryAfter: number,
  ) {
    super(
      status === 401
        ? 'HTTP 401: This file requires a website login. Use the site’s browser download.'
        : status === 403
          ? 'HTTP 403: Access was denied. The link may have expired or require a website login.'
          : `Server returned HTTP ${status}.`,
    );
  }
}
export class RangeErrorResponse extends Error {}
export function retryDelay(attempt: number, retryAfter = 0) {
  return Math.max(retryAfter, Math.min(30000, 500 * 2 ** attempt));
}
export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now) || 0;
}
export function retryable(error: unknown) {
  return error instanceof HttpError
    ? [408, 425, 429, 500, 502, 503, 504].includes(error.status)
    : error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
}
export function numberHeader(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export async function request(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
  allowLocal = false,
  policy?: RedirectPolicy,
) {
  let current = validateUrl(url, allowLocal).href;
  const visited = new Set<string>();
  for (let hop = 0; hop < 10; hop++) {
    if (visited.has(current)) throw new Error('The server returned a redirect loop.');
    visited.add(current);
    await policy?.prepareRequest?.(current, init.signal ?? new AbortController().signal);
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new DOMException('Server headers timed out.', 'TimeoutError')),
      30000,
    );
    let response: Response;
    try {
      response = await fetcher(current, {
        ...init,
        signal: init.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal,
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const next = policy
        ? await policy.resolveRedirect(
            current,
            location,
            init.signal ?? new AbortController().signal,
          )
        : location
          ? new URL(location, current).href
          : null;
      if (!next)
        throw new Error(
          'Chrome did not expose this redirect destination. Retry or use the site’s browser download.',
        );
      const validated = validateUrl(next, allowLocal);
      if (new URL(current).protocol === 'https:' && validated.protocol === 'http:')
        throw new Error('An insecure HTTPS-to-HTTP redirect was blocked.');
      current = validated.href;
      continue;
    }
    if (
      !response.ok &&
      !(
        response.status === 416 &&
        response.headers.get('content-range') === 'bytes */0' &&
        new Headers(init.headers).get('range') === 'bytes=0-0'
      )
    ) {
      await response.body?.cancel();
      throw new HttpError(response.status, retryAfterMs(response.headers.get('retry-after')));
    }
    return response;
  }
  throw new Error('The server returned too many redirects.');
}
export async function probe(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  allowLocal = false,
  policy?: RedirectPolicy,
): Promise<Resource> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      response = await request(
        url,
        { headers: { Range: 'bytes=0-0' }, signal },
        fetcher,
        allowLocal,
        policy,
      );
      break;
    } catch (error) {
      checkAbort(signal);
      if (error instanceof HttpError && [400, 403, 405, 416, 501].includes(error.status)) {
        response = await request(url, { signal }, fetcher, allowLocal, policy);
        break;
      }
      if (attempt === 3 || !retryable(error)) throw error;
      await sleep(retryDelay(attempt, error instanceof HttpError ? error.retryAfter : 0), signal);
    }
  }
  if (!response) throw new Error('No response.');
  try {
    const encoded = response.headers.get('content-encoding');
    const identity = !encoded || encoded.toLowerCase() === 'identity';
    let size = numberHeader(response.headers.get('content-length'));
    let ranges = false;
    if (response.status === 416) size = 0;
    if (response.status === 206) {
      try {
        const range = parseContentRange(response.headers.get('content-range'));
        if (range.start === 0 && range.end === 0) {
          size = range.total;
          ranges = identity;
        } else size = null;
      } catch {
        size = null;
      }
    }
    const etag = response.headers.get('etag');
    const modified = response.headers.get('last-modified');
    const validator = (!!etag && !etag.startsWith('W/')) || !!modified;
    const safeRanges = ranges && validator;
    return {
      finalUrl: response.url || url,
      size: identity ? size : null,
      ranges: safeRanges,
      etag,
      modified,
      mime: response.headers.get('content-type') ?? 'application/octet-stream',
      filename: filenameFromHeaders(
        response.headers.get('content-disposition'),
        response.url || url,
      ),
      reason: !identity
        ? 'Encoded response: safe single-stream transfer.'
        : !ranges
          ? 'Server does not provide verified byte ranges.'
          : !validator
            ? 'No reliable resource validator: safe single-stream transfer.'
            : undefined,
    };
  } finally {
    await response.body?.cancel();
  }
}
