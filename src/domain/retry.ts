import type { DownloadJob, DownloadQueue, Settings } from './model';

export function retryPolicy(settings: Settings, queue?: DownloadQueue) {
  return {
    attempts: queue?.retryAttempts ?? settings.retryAttempts ?? 0,
    seconds: queue?.retryDelaySeconds ?? settings.retryDelaySeconds ?? 60,
  };
}

/** Only a typed transient engine failure authorizes a later automatic attempt. */
export function nextRetryAt(job: DownloadJob, settings: Settings): number | null {
  if (
    job.engine === 'browser' ||
    job.state !== 'FAILED' ||
    !job.retryFailure ||
    job.sha256 ||
    job.permissionOrigin ||
    job.capturePending
  )
    return null;
  const { attempts, seconds } = retryPolicy(
    settings,
    settings.queues.find((queue) => queue.id === job.queueId),
  );
  const used = job.queueRetries ?? 0;
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 20 ||
    !Number.isInteger(used) ||
    used < 0 ||
    used >= attempts ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 86400
  )
    return null;
  const { at, notBefore } = job.retryFailure;
  const next = Math.max(at + Math.min(86400000, seconds * 1000 * 2 ** used), notBefore);
  return [at, notBefore, next].every(
    (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000,
  )
    ? next
    : null;
}

export function retryDue(job: DownloadJob, now = Date.now()) {
  return (
    job.engine !== 'browser' &&
    job.state === 'FAILED' &&
    !!job.retryFailure &&
    job.queueRetryAt != null &&
    job.queueRetryAt <= now
  );
}

export function hasPendingTransfer(job: DownloadJob, settings: Settings) {
  return (
    !['COMPLETED', 'CANCELED', 'FAILED'].includes(job.state) ||
    (job.state === 'FAILED' && (job.queueRetryAt != null || nextRetryAt(job, settings) != null))
  );
}
