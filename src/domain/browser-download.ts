import type { DownloadJob } from './model';
import { validateUrl } from '../shared/security';
import { categoryOf, filenameFromHeaders, sanitizeFilename } from '../shared/files';

export function browserReference(
  item: Pick<chrome.downloads.DownloadItem, 'url' | 'finalUrl' | 'referrer'>,
) {
  const source = item.finalUrl || item.url;
  if (source.length > 16384 && !source.startsWith('data:'))
    throw new Error('Download address is too long.');
  if (/^https?:/i.test(source)) {
    const url = validateUrl(source);
    return { url, storedUrl: url.href, sourceKind: 'http' as const };
  }
  if (source.startsWith('blob:')) {
    const url = validateUrl(source.slice(5));
    return { url, storedUrl: source, sourceKind: 'blob' as const };
  }
  if (source.startsWith('data:')) {
    // Payload-bearing data URLs are never copied into the queue or diagnostics.
    const url = validateUrl(item.referrer);
    return { url, storedUrl: url.href, sourceKind: 'data' as const };
  }
  throw new Error('This browser download has no supported public source reference.');
}

export function browserNeedsReview(danger: string) {
  return !['safe', 'accepted', 'deepScannedSafe', 'allowlistedByPolicy'].includes(danger);
}

export function createBrowserJob(item: chrome.downloads.DownloadItem): DownloadJob {
  const reference = browserReference(item);
  const now = Date.now();
  const filename = sanitizeFilename(
    item.filename.split(/[\\/]/).pop() ||
      (reference.sourceKind === 'http'
        ? filenameFromHeaders(null, reference.storedUrl)
        : 'download'),
  );
  const job: DownloadJob = {
    id: crypto.randomUUID(),
    engine: 'browser',
    url: reference.storedUrl,
    queueId: 'default',
    filename,
    category: categoryOf(filename),
    state: 'DOWNLOADING',
    createdAt: Number.isFinite(Date.parse(item.startTime)) ? Date.parse(item.startTime) : now,
    updatedAt: now,
    priority: 0,
    order: now,
    scheduledAt: null,
    speedLimit: 0,
    maxConnections: 1,
    mode: 'manual',
    resource: null,
    segments: [],
    downloaded: 0,
    total: null,
    speed: 0,
    averageSpeed: 0,
    connections: 0,
    connectionSpeeds: [],
    retries: 0,
    error: null,
    note: null,
    sha256: null,
    expectedHash: null,
    timeline: [{ at: now, event: 'Original browser transfer linked to Flux' }],
    exported: false,
    exportedAt: null,
    activeMs: 0,
    browser: {
      id: item.id,
      startedAt: item.startTime,
      canResume: item.canResume,
      danger: item.danger,
      sourceKind: reference.sourceKind,
    },
  };
  return updateBrowserJob(job, item);
}

export function updateBrowserJob(
  job: DownloadJob,
  item: chrome.downloads.DownloadItem,
  now = Date.now(),
): DownloadJob {
  if (
    job.engine !== 'browser' ||
    job.browser?.id !== item.id ||
    job.browser.startedAt !== item.startTime
  )
    throw new Error('Browser transfer identity changed.');
  const review = browserNeedsReview(item.danger);
  const state =
    item.state === 'complete'
      ? 'COMPLETED'
      : item.state === 'interrupted'
        ? item.error === 'USER_CANCELED'
          ? 'CANCELED'
          : 'FAILED'
        : item.paused || review
          ? 'PAUSED'
          : 'DOWNLOADING';
  let referrer: string | undefined;
  try {
    referrer = item.referrer ? validateUrl(item.referrer).href : undefined;
  } catch {
    /* Never open an unsupported referrer. */
  }
  const filename = item.filename
    ? sanitizeFilename(item.filename.split(/[\\/]/).pop() || job.filename)
    : job.filename;
  return {
    ...job,
    filename,
    category: categoryOf(filename),
    state,
    updatedAt: now,
    downloaded:
      Number.isSafeInteger(item.bytesReceived) && item.bytesReceived >= 0
        ? item.bytesReceived
        : job.downloaded,
    total: Number.isSafeInteger(item.totalBytes) && item.totalBytes >= 0 ? item.totalBytes : null,
    speed: 0,
    connections: 0,
    connectionSpeeds: [],
    sha256: null,
    segments: [],
    resource: null,
    error:
      item.state === 'interrupted' && item.error !== 'USER_CANCELED'
        ? `Chrome interrupted the original request: ${item.error ?? 'unknown reason'}.`
        : null,
    note: review
      ? 'Review this download in Chrome before continuing. Flux does not approve browser security warnings.'
      : item.exists === false && state === 'COMPLETED'
        ? 'The browser reports that the saved file is no longer present.'
        : `Original browser request. Destination, authentication and transfer behavior are managed by Chrome.${job.expectedHash ? ' The expected SHA-256 has not been verified for this browser transfer.' : ''}`,
    exported: state === 'COMPLETED',
    exportedAt:
      state === 'COMPLETED' ? (job.exportedAt ?? (Date.parse(item.endTime ?? '') || now)) : null,
    activeMs: Math.max(0, now - job.createdAt),
    browser: {
      ...job.browser,
      canResume: item.canResume,
      danger: item.danger,
      referrer,
      missing: item.exists === false,
    },
    timeline:
      state !== job.state
        ? [
            ...job.timeline.slice(-99),
            { at: now, event: `Browser transfer ${state.toLowerCase()}` },
          ]
        : job.timeline,
  };
}
