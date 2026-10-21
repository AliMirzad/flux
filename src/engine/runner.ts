import { createSHA256 } from 'hash-wasm';
import type { EngineOptions, ByteStore } from './ports';
import type { DownloadJob, Segment, Resource } from '../domain/model';
import { TrafficLimitError } from './speed/budget';
import { transition } from '../domain/state';
import { categoryOf } from '../shared/files';
import {
  completeBytes,
  compatibleResource,
  missingRanges,
  parseContentRange,
} from './segmentation/ranges';
import {
  HttpError,
  RangeErrorResponse,
  probe,
  request,
  retryable,
  retryDelay,
  numberHeader,
} from './network/http';
import {
  AdaptiveController,
  BandwidthLimiter,
  SpeedMeter,
  checkAbort,
  sleep,
} from './speed/control';

export async function hashRegion(
  store: ByteStore,
  start: number,
  length: number,
  signal: AbortSignal,
) {
  const hash = await createSHA256();
  hash.init();
  for (let offset = start; offset < start + length; offset += 262144) {
    checkAbort(signal);
    const bytes = await store.read(offset, Math.min(262144, start + length - offset));
    if (bytes.length !== Math.min(262144, start + length - offset))
      throw new Error('Partial file is missing data.');
    hash.update(bytes);
    if (offset % 4194304 === 0) await sleep(0, signal);
  }
  return hash.digest('hex');
}
export async function verifyStoredFile(store: ByteStore, segments: Segment[], signal: AbortSignal) {
  const full = await createSHA256();
  const segmentHash = await createSHA256();
  full.init();
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    segmentHash.init();
    for (let offset = segment.start; offset <= segment.end; offset += 262144) {
      checkAbort(signal);
      const length = Math.min(262144, segment.end - offset + 1);
      const bytes = await store.read(offset, length);
      if (bytes.length !== length) throw new Error('Partial file is missing data.');
      full.update(bytes);
      segmentHash.update(bytes);
      if (offset % 4194304 === 0) await sleep(0, signal);
    }
    if (segmentHash.digest('hex') !== segment.hash)
      throw new Error(
        'Persisted range failed integrity verification. File has not been approved for export.',
      );
  }
  return full.digest('hex');
}

export async function runDownload(options: EngineOptions) {
  const { job, settings, store, signal, checkpoint, progress } = options;
  job.sha256 = null;
  const fetcher = options.fetcher ?? fetch;
  await store.open(job.id);
  const started = performance.now();
  const baseActive = job.activeMs;
  let received = 0;
  let lastProgress = 0;
  const meter = new SpeedMeter();
  const limiter = new BandwidthLimiter(job.speedLimit);
  const adaptive = new AdaptiveController(Math.min(job.maxConnections, settings.perHost));
  const connectionMeters = new Map<number, SpeedMeter>();
  const emit = (force = false) => {
    const now = performance.now();
    if (!force && now - lastProgress < 250) return;
    lastProgress = now;
    job.speed = meter.rate();
    job.averageSpeed = received / Math.max(0.001, (now - started) / 1000);
    job.activeMs = baseActive + now - started;
    job.connectionSpeeds = [...connectionMeters.values()].map((m) => m.rate());
    progress(structuredClone(job));
  };
  let durable = completeBytes(job.segments);
  const activeBytes = new Map<number, number>();
  const updateBytes = () => {
    job.downloaded = durable + [...activeBytes.values()].reduce((a, b) => a + b, 0);
  };
  // IDB checkpoints must serialize; callers otherwise risk committing an older range set last.
  let saving = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(job);
    snapshot.downloaded = completeBytes(snapshot.segments);
    snapshot.speed = 0;
    snapshot.connections = 0;
    saving = saving.then(() => checkpoint(snapshot));
    return saving;
  };
  const consume = async (
    response: Response,
    start: number,
    end: number | null,
    index: number,
    requestSignal: AbortSignal,
    prepaid = false,
  ) => {
    if (!response.body) throw new Error('Server returned no response body.');
    const reader = response.body.getReader();
    const hash = await createSHA256();
    hash.init();
    let count = 0;
    try {
      while (true) {
        checkAbort(requestSignal);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const idle = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new DOMException('Server stalled.', 'TimeoutError')),
            30000,
          );
        });
        const result = await Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
        if (result.done) break;
        if (end !== null && start + count + result.value.length - 1 > end)
          throw new RangeErrorResponse('Server returned more bytes than requested.');
        await limiter.consume(result.value.length, requestSignal);
        await options.globalThrottle?.(result.value.length, requestSignal);
        if (!prepaid) await options.accountPayload?.(result.value.length, requestSignal);
        checkAbort(requestSignal);
        await store.write(start + count, result.value);
        hash.update(result.value);
        count += result.value.length;
        received += result.value.length;
        activeBytes.set(index, count);
        updateBytes();
        meter.add(result.value.length);
        connectionMeters.get(index)?.add(result.value.length);
        emit();
      }
      if (end !== null && count !== end - start + 1) throw new TypeError('Response was truncated.');
      return { count, hash: hash.digest('hex') };
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  };
  try {
    let resource: Resource;
    await options.checkAllowance?.(signal);
    const releaseProbe = await options.acquireHost?.(new URL(job.url).hostname, signal);
    try {
      resource = await probe(
        job.url,
        signal,
        fetcher,
        options.allowLocalForTests,
        options.redirectPolicy,
      );
    } finally {
      releaseProbe?.();
    }
    if (job.resource && job.segments.length) {
      if (!compatibleResource(job.resource, resource)) {
        job.segments = [];
        job.note = 'Remote resource changed or could not be validated. Restarted safely.';
        await store.truncate(0);
      } else {
        const valid: Segment[] = [];
        for (const segment of job.segments) {
          if (
            (await hashRegion(store, segment.start, segment.end - segment.start + 1, signal)) !==
            segment.hash
          )
            throw new Error(
              'Stored partial data failed integrity verification. Cancel and retry to restart.',
            );
          valid.push(segment);
        }
        job.segments = valid;
      }
    }
    if (!job.resource && job.filename === 'download') job.filename = resource.filename;
    // URL-derived names may be replaced by a server filename; explicit names survive.
    if (!job.resource && job.filename === new URL(job.url).pathname.split('/').pop())
      job.filename = resource.filename;
    job.category = categoryOf(job.filename);
    job.resource = resource;
    if (
      !resource.ranges &&
      resource.size !== null &&
      settings.trafficLimit > 0 &&
      resource.size > settings.trafficLimit
    )
      throw new Error(
        'This server cannot resume the file within the current download allowance. Increase the allowance or disable it for this transfer.',
      );
    job.total = resource.size;
    job.note = job.note ?? resource.reason ?? null;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate && resource.size !== null) {
      const estimate = await navigator.storage.estimate();
      const missing = Math.max(0, resource.size - completeBytes(job.segments));
      if (
        estimate.quota !== undefined &&
        estimate.usage !== undefined &&
        estimate.quota - estimate.usage < missing + 1048576
      )
        throw new DOMException(
          'Insufficient browser storage. Remove temporary downloads or free disk space.',
          'QuotaExceededError',
        );
    }
    durable = completeBytes(job.segments);
    job.downloaded = durable;
    await save();
    checkAbort(signal);
    transition(job, 'DOWNLOADING');
    emit(true);
    const singleOnce = async () => {
      await store.truncate(0);
      job.segments = [];
      durable = 0;
      activeBytes.clear();
      job.downloaded = 0;
      await save();
      const release = await options.acquireHost?.(new URL(resource.finalUrl).hostname, signal);
      try {
        const allowance = resource.size;
        if (allowance !== null) await options.reservePayload?.(allowance, signal);
        const response = await request(
          resource.finalUrl,
          { signal },
          fetcher,
          options.allowLocalForTests,
          options.redirectPolicy,
        );
        if (response.status !== 200) {
          await response.body?.cancel();
          throw new Error('Unexpected single-stream response.');
        }
        const encoded = response.headers.get('content-encoding');
        const size =
          encoded && encoded !== 'identity'
            ? null
            : numberHeader(response.headers.get('content-length'));
        if (allowance !== null && size !== null && size > allowance) {
          try {
            await options.reservePayload?.(size - allowance, signal);
          } catch (error) {
            await response.body?.cancel().catch(() => undefined);
            throw error;
          }
        }
        job.total = size;
        job.connections = 1;
        connectionMeters.set(0, new SpeedMeter());
        emit(true);
        const result = await consume(
          response,
          0,
          size === null ? null : size - 1,
          0,
          signal,
          !!options.reservePayload && allowance !== null && size !== null,
        );
        checkAbort(signal);
        await store.truncate(result.count);
        await store.flush();
        job.total = result.count;
        job.segments = result.count ? [{ start: 0, end: result.count - 1, hash: result.hash }] : [];
        durable = result.count;
        activeBytes.clear();
        updateBytes();
        await save();
      } finally {
        release?.();
        connectionMeters.clear();
        job.connections = 0;
      }
    };
    const single = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await singleOnce();
          return;
        } catch (error) {
          checkAbort(signal);
          if (!retryable(error) || attempt === 4) throw error;
          job.retries++;
          job.timeline = [
            ...job.timeline.slice(-99),
            {
              at: Date.now(),
              event: 'Restarting single-stream transfer after a temporary failure',
            },
          ];
          emit(true);
          await sleep(
            retryDelay(attempt, error instanceof HttpError ? error.retryAfter : 0),
            signal,
          );
        }
      }
    };
    if (resource.ranges && resource.size !== null) {
      // Bounded task descriptors: at most 32768 chunks even at safe integer offsets.
      const chunkSize = Math.max(1024 * 1024, Math.ceil(resource.size / 32768));
      const pending = missingRanges(resource.size, job.segments, chunkSize);
      let next = 0;
      let serial = 0;
      let rangeFailure: unknown;
      const scope = new AbortController();
      const rangeSignal = AbortSignal.any([signal, scope.signal]);
      const active = new Set<Promise<void>>();
      const runRange = async (range: { start: number; end: number }, index: number) => {
        const release = await options.acquireHost?.(
          new URL(resource.finalUrl).hostname,
          rangeSignal,
        );
        job.connections++;
        const cm = new SpeedMeter();
        connectionMeters.set(index, cm);
        try {
          for (let attempt = 0; attempt < 5; attempt++) {
            checkAbort(rangeSignal);
            activeBytes.set(index, 0);
            updateBytes();
            try {
              await options.reservePayload?.(range.end - range.start + 1, rangeSignal);
              const validator =
                resource.etag && !resource.etag.startsWith('W/')
                  ? resource.etag
                  : resource.modified;
              const headers: Record<string, string> = {
                Range: `bytes=${range.start}-${range.end}`,
              };
              if (validator) headers['If-Range'] = validator;
              const response = await request(
                resource.finalUrl,
                { headers, signal: rangeSignal },
                fetcher,
                options.allowLocalForTests,
                options.redirectPolicy,
              );
              const encoding = response.headers.get('content-encoding');
              try {
                if (response.status !== 206 || (encoding && encoding !== 'identity'))
                  throw new RangeErrorResponse('Range response was ignored or encoded.');
                const returned = parseContentRange(response.headers.get('content-range'));
                if (
                  returned.start !== range.start ||
                  returned.end !== range.end ||
                  returned.total !== resource.size
                )
                  throw new RangeErrorResponse('Server changed the requested range.');
                if (
                  (resource.etag && response.headers.get('etag') !== resource.etag) ||
                  (!resource.etag &&
                    resource.modified &&
                    response.headers.get('last-modified') !== resource.modified)
                )
                  throw new RangeErrorResponse('Resource validator changed during transfer.');
              } catch (error) {
                await response.body?.cancel();
                throw error instanceof RangeErrorResponse
                  ? error
                  : new RangeErrorResponse('Invalid range response.');
              }
              const result = await consume(
                response,
                range.start,
                range.end,
                index,
                rangeSignal,
                !!options.reservePayload,
              );
              checkAbort(rangeSignal);
              await store.flush();
              job.segments.push({ ...range, hash: result.hash });
              durable += result.count;
              activeBytes.delete(index);
              updateBytes();
              await save();
              return;
            } catch (error) {
              checkAbort(rangeSignal);
              activeBytes.delete(index);
              updateBytes();
              if (error instanceof RangeErrorResponse || !retryable(error)) throw error;
              if (job.mode !== 'manual') {
                adaptive.sample(meter.rate(), true, performance.now(), job.connections);
                // Over the lowered target this connection closes and hands its range back,
                // rather than spending retries against a server that refuses that many.
                if (job.connections > adaptive.target) {
                  pending.splice(next, 0, range);
                  return;
                }
              }
              if (attempt === 4) throw error;
              job.retries++;
              job.timeline = [
                ...job.timeline.slice(-99),
                {
                  at: Date.now(),
                  event: `Retrying range after ${error instanceof HttpError ? 'HTTP ' + error.status : 'connection interruption'}`,
                },
              ];
              emit(true);
              await sleep(
                retryDelay(attempt, error instanceof HttpError ? error.retryAfter : 0),
                rangeSignal,
              );
            }
          }
        } finally {
          release?.();
          job.connections--;
          connectionMeters.delete(index);
          activeBytes.delete(index);
          updateBytes();
        }
      };
      // Adaptive sampling runs on a clock, not on range completion, so long ranges cannot
      // stall ramp-up; a raised target wakes the scheduler to open connections at once.
      let wake: (() => void) | null = null;
      const ticker = setInterval(() => {
        if (job.mode === 'manual') return;
        const before = adaptive.target;
        adaptive.sample(meter.rate(), false, performance.now(), job.connections);
        if (adaptive.target > before) wake?.();
      }, 500);
      try {
        while (next < pending.length || active.size) {
          checkAbort(signal);
          const target =
            job.mode === 'manual'
              ? Math.min(job.maxConnections, settings.perHost)
              : adaptive.target;
          while (next < pending.length && active.size < target && !rangeFailure) {
            const range = { ...pending[next]! };
            const allowanceChunk =
              settings.trafficLimit > 0 ? Math.min(1024 * 1024, settings.trafficLimit) : null;
            if (allowanceChunk !== null && range.end - range.start + 1 > allowanceChunk) {
              range.end = range.start + allowanceChunk - 1;
              pending[next]!.start = range.end + 1;
            } else next++;
            // Aim for roughly two seconds of work, bounded to preserve pause granularity.
            const desired =
              allowanceChunk ??
              Math.max(
                chunkSize,
                Math.min(16 * 1024 * 1024, (meter.rate() / Math.max(1, active.size)) * 2),
              );
            while (
              next < pending.length &&
              pending[next]!.start === range.end + 1 &&
              pending[next]!.end - range.start + 1 <= desired
            )
              range.end = pending[next++]!.end;
            let task: Promise<void>;
            task = runRange(range, serial++)
              .catch((error) => {
                if (
                  !rangeFailure ||
                  (rangeFailure instanceof TrafficLimitError &&
                    !(error instanceof TrafficLimitError))
                ) {
                  rangeFailure = error;
                  if (!(error instanceof TrafficLimitError)) scope.abort();
                }
              })
              .finally(() => active.delete(task));
            active.add(task);
          }
          if (active.size)
            await Promise.race([...active, new Promise<void>((resolve) => (wake = resolve))]);
          wake = null;
          if (rangeFailure) {
            await Promise.all(active);
            break;
          }
        }
      } finally {
        clearInterval(ticker);
        scope.abort();
        await Promise.all(active);
      }
      if (rangeFailure) {
        checkAbort(signal);
        if (rangeFailure instanceof RangeErrorResponse) {
          job.note = 'Server range responses became unsafe. Restarted as a single stream.';
          resource.ranges = false;
          await single();
        } else throw rangeFailure;
      }
    } else await single();
    checkAbort(signal);
    job.connections = 0;
    job.connectionSpeeds = [];
    const size = await store.size();
    if (
      job.total === null ||
      size !== job.total ||
      completeBytes(job.segments) !== job.total ||
      missingRanges(job.total, job.segments, Math.max(1, job.total)).length
    )
      throw new Error('Final byte coverage validation failed.');
    job.note = job.note ?? 'All byte ranges verified. Ready to save.';
    job.sha256 = await verifyStoredFile(store, job.segments, signal);
    if (job.expectedHash && job.sha256 !== job.expectedHash) {
      job.sha256 = null;
      throw new Error(
        'SHA-256 does not match the expected checksum. File has not been approved for export.',
      );
    }
    transition(job, 'ASSEMBLING', 'Transfer verified · ready to save');
    job.downloaded = size;
    job.speed = 0;
    emit(true);
    await save();
  } finally {
    // Drain any checkpoint before releasing file locks. Aborted incomplete ranges are never committed.
    try {
      await saving;
    } finally {
      await store.close();
    }
    job.speed = 0;
    job.connections = 0;
    job.connectionSpeeds = [];
    job.activeMs = baseActive + performance.now() - started;
  }
}
