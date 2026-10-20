import { request, retryable, retryDelay, HttpError } from '../network/http';
import type { EngineOptions } from '../ports';
import { checkAbort, sleep } from '../speed/control';
import { maxManifestBytes, parseHls } from './hls';
import type { HlsReview } from './types';
export type MediaNetwork = Pick<
  EngineOptions,
  'signal' | 'fetcher' | 'redirectPolicy' | 'allowLocalForTests' | 'acquireHost'
>;
export async function mediaRequest(url: string, init: RequestInit, options: MediaNetwork) {
  const release = await options.acquireHost?.(new URL(url).hostname, options.signal);
  try {
    const response = await request(
      url,
      { ...init, signal: options.signal },
      options.fetcher ?? fetch,
      options.allowLocalForTests,
      options.redirectPolicy,
    );
    if (!response.body) {
      release?.();
      return response;
    }
    const reader = response.body.getReader();
    let released = false;
    const finish = () => {
      if (!released) {
        released = true;
        release?.();
      }
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) {
            finish();
            controller.close();
          } else controller.enqueue(part.value);
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    });
    const wrapped = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(wrapped, 'url', { value: response.url });
    return wrapped;
  } catch (error) {
    release?.();
    throw error;
  }
}
export async function readMediaBody(
  response: Response,
  signal: AbortSignal,
  onChunk: (bytes: Uint8Array) => Promise<void>,
) {
  if (!response.body) throw new Error('Media server returned no response body.');
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      checkAbort(signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DOMException('Media server stalled.', 'TimeoutError')),
          30000,
        );
      });
      const part = await Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timer));
      if (part.done) break;
      for (let offset = 0; offset < part.value.length; offset += 262144)
        await onChunk(part.value.subarray(offset, Math.min(offset + 262144, part.value.length)));
    }
    checkAbort(signal);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function mediaRetry<T>(
  operation: () => Promise<T>,
  options: MediaNetwork,
  onRetry?: () => void,
) {
  for (let attempt = 0; ; attempt++) {
    checkAbort(options.signal);
    try {
      return await operation();
    } catch (error) {
      checkAbort(options.signal);
      if (attempt === 3 || !retryable(error)) throw error;
      onRetry?.();
      await sleep(
        retryDelay(attempt, error instanceof HttpError ? error.retryAfter : 0),
        options.signal,
      );
    }
  }
}
export async function fetchHls(url: string, options: MediaNetwork) {
  return mediaRetry(async () => {
    const response = await mediaRequest(url, {}, options);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    await readMediaBody(response, options.signal, async (chunk) => {
      bytes += chunk.length;
      if (bytes > maxManifestBytes) throw new Error('HLS playlist exceeds 4 MiB.');
      chunks.push(chunk.slice());
    });
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data),
      finalUrl = response.url || url;
    return {
      text,
      url: finalUrl,
      manifest: parseHls(text, finalUrl, options.allowLocalForTests),
      etag: response.headers.get('etag'),
      modified: response.headers.get('last-modified'),
    };
  }, options);
}
export async function reviewHls(url: string, options: MediaNetwork): Promise<HlsReview> {
  const result = await fetchHls(url, options);
  if (result.manifest.kind === 'master')
    return { kind: 'master', url: result.url, variants: result.manifest.variants };
  const origins = [
    ...new Set(
      [result.url, result.manifest.init.url, ...result.manifest.parts.map((part) => part.url)].map(
        (url) => new URL(url).origin,
      ),
    ),
  ];
  if (origins.length > 64) throw new Error('This HLS rendition uses too many different hosts.');
  return {
    kind: 'media',
    url: result.url,
    parts: result.manifest.parts.length,
    duration: result.manifest.duration,
    origins,
  };
}
