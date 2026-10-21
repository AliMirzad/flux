import {
  defaultSettings,
  type DownloadJob,
  type NewDownload,
  type Settings,
} from '../domain/model';
import { filenameFromHeaders, categoryOf, sanitizeFilename } from '../shared/files';
import { validateUrl } from '../shared/security';
export const downloadIdentity = (url: string, audioUrl?: string) =>
  JSON.stringify([url, audioUrl ?? null]);
export function createJob(
  input: NewDownload,
  settings: Settings = defaultSettings,
  allowLocal = false,
): DownloadJob {
  const url = validateUrl(input.url, allowLocal).href;
  if (input.useBrowserCookies !== undefined && typeof input.useBrowserCookies !== 'boolean')
    throw new Error('Invalid browser session preference.');
  if (input.media !== undefined && input.media !== 'hls')
    throw new Error('Unsupported media download type.');
  if ((input.audioUrl !== undefined || input.audioLabel !== undefined) && input.media !== 'hls')
    throw new Error('A separate audio rendition requires an HLS download.');
  const audioUrl =
    input.audioUrl === undefined ? undefined : validateUrl(input.audioUrl, allowLocal).href;
  if (audioUrl && new URL(url).protocol === 'https:' && new URL(audioUrl).protocol === 'http:')
    throw new Error('An insecure HLS audio address was blocked.');
  if (
    input.audioLabel !== undefined &&
    (typeof input.audioLabel !== 'string' ||
      input.audioLabel.length > 256 ||
      /[\x00-\x1f\x7f]/.test(input.audioLabel))
  )
    throw new Error('Invalid HLS audio label.');
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
  if (input.maxConnections !== undefined && ![1, 2, 4, 8, 16].includes(input.maxConnections))
    throw new Error('Connections must be 1, 2, 4, 8 or 16.');
  if (input.expectedHash && !/^[a-f\d]{64}$/i.test(input.expectedHash))
    throw new Error('SHA-256 must contain 64 hexadecimal characters.');
  let filename = input.filename ? sanitizeFilename(input.filename) : filenameFromHeaders(null, url);
  if (input.media && !/\.(mp4|m4a)$/i.test(filename))
    filename = sanitizeFilename(filename.replace(/\.m3u8?$/i, '') + '.mp4');
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    useBrowserCookies: input.useBrowserCookies === true,
    ...(input.media
      ? {
          media: {
            kind: input.media,
            ...(audioUrl ? { audioUrl, audioLabel: input.audioLabel } : {}),
          },
        }
      : {}),
    queueId: input.queueId ?? 'default',
    url,
    filename,
    category: input.category ?? categoryOf(filename),
    state: input.startPaused ? 'PAUSED' : 'QUEUED',
    createdAt: now,
    updatedAt: now,
    priority: input.priority ?? 0,
    order: now,
    scheduledAt: input.scheduledAt ?? null,
    speedLimit: Math.max(0, input.speedLimit ?? 0),
    maxConnections: input.media ? 1 : (input.maxConnections ?? settings.maxConnections),
    mode: input.media ? 'manual' : (input.mode ?? settings.mode),
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
