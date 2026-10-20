import {
  defaultSettings,
  type DownloadJob,
  type NewDownload,
  type Settings,
} from '../domain/model';
import { filenameFromHeaders, categoryOf, sanitizeFilename } from '../shared/files';
import { validateUrl } from '../shared/security';
export function createJob(
  input: NewDownload,
  settings: Settings = defaultSettings,
  allowLocal = false,
): DownloadJob {
  const url = validateUrl(input.url, allowLocal).href;
  if (input.media !== undefined && input.media !== 'hls')
    throw new Error('Unsupported media download type.');
  if (
    input.priority !== undefined &&
    (!Number.isFinite(input.priority) || Math.abs(input.priority) > 100)
  )
    throw new Error('Priority must be between -100 and 100.');
  if (
    input.speedLimit !== undefined &&
    (!Number.isFinite(input.speedLimit) || input.speedLimit < 0 || input.speedLimit > 1e12)
  )
    throw new Error('Invalid speed limit.');
  if (
    input.scheduledAt !== undefined &&
    input.scheduledAt !== null &&
    (!Number.isFinite(input.scheduledAt) ||
      input.scheduledAt < 0 ||
      input.scheduledAt > 8640000000000000)
  )
    throw new Error('Invalid scheduled date.');
  if (input.expectedHash && !/^[a-f\d]{64}$/i.test(input.expectedHash))
    throw new Error('SHA-256 must contain 64 hexadecimal characters.');
  let filename = input.filename ? sanitizeFilename(input.filename) : filenameFromHeaders(null, url);
  if (input.media && !/\.(mp4|m4a)$/i.test(filename))
    filename = sanitizeFilename(filename.replace(/\.m3u8?$/i, '') + '.mp4');
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    ...(input.media ? { media: { kind: input.media } } : {}),
    queueId: input.queueId ?? 'default',
    url,
    filename,
    category: categoryOf(filename),
    state: input.startPaused ? 'PAUSED' : 'QUEUED',
    createdAt: now,
    updatedAt: now,
    priority: input.priority ?? 0,
    order: now,
    scheduledAt: input.scheduledAt ?? null,
    speedLimit: Math.max(0, input.speedLimit ?? 0),
    maxConnections: input.media ? 1 : settings.maxConnections,
    mode: input.media ? 'manual' : settings.mode,
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
    expectedHash: input.expectedHash?.toLowerCase() ?? null,
    timeline: [{ at: now, event: 'Added to queue' }],
    exported: false,
    exportedAt: null,
    activeMs: 0,
  };
}
