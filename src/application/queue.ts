import type { DownloadJob, Settings, DownloadQueue } from '../domain/model';
import { retryDue } from '../domain/retry';
export function inTimeWindow(
  settings: Pick<Settings, 'windowStart' | 'windowEnd'>,
  date = new Date(),
) {
  if (!settings.windowStart || !settings.windowEnd || settings.windowStart === settings.windowEnd)
    return true;
  const now = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return settings.windowStart < settings.windowEnd
    ? now >= settings.windowStart && now < settings.windowEnd
    : now >= settings.windowStart || now < settings.windowEnd;
}
export function orderedQueue(jobs: DownloadJob[], now = Date.now()) {
  return jobs
    .filter(
      (j) => (j.state === 'QUEUED' || retryDue(j, now)) && (!j.scheduledAt || j.scheduledAt <= now),
    )
    .sort((a, b) => b.priority - a.priority || a.order - b.order || a.createdAt - b.createdAt);
}
export function nextWindowBoundary(
  settings: Pick<Settings, 'windowStart' | 'windowEnd'>,
  date = new Date(),
): number | null {
  if (!settings.windowStart || !settings.windowEnd || settings.windowStart === settings.windowEnd)
    return null;
  const time = inTimeWindow(settings, date) ? settings.windowEnd : settings.windowStart;
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= date.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** In an overnight window, the selected weekday belongs to the window's opening day. */
export function queueAvailable(queue: DownloadQueue, date = new Date()) {
  const now = date.getTime();
  if (queue.paused) return false;
  // "Start now" runs the queue immediately, ignoring its schedule until it finishes or is stopped.
  if (queue.manualRun) return true;
  if (
    (queue.startsAt != null && now < queue.startsAt) ||
    (queue.stopsAt != null && now >= queue.stopsAt)
  )
    return false;
  const openingDay = new Date(date);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  // A start time alone opens the queue for the rest of that day (the engine then latches a run
  // until the queue finishes); a stop time alone closes it for the rest of the day.
  if (queue.windowStart && !queue.windowEnd) {
    if (time < queue.windowStart) return false;
  } else if (!queue.windowStart && queue.windowEnd) {
    if (time >= queue.windowEnd) return false;
  } else if (!inTimeWindow(queue, date)) return false;
  if (
    queue.windowStart &&
    queue.windowEnd &&
    queue.windowStart > queue.windowEnd &&
    time < queue.windowEnd
  )
    openingDay.setDate(openingDay.getDate() - 1);
  return !queue.days || queue.days.includes(openingDay.getDay());
}

export function nextQueueBoundary(queue: DownloadQueue, date = new Date()): number | null {
  if (
    queue.paused ||
    queue.manualRun ||
    queue.days?.length === 0 ||
    (queue.stopsAt != null && date.getTime() >= queue.stopsAt)
  )
    return null;
  const now = date.getTime();
  const candidates: number[] = [];
  if (queue.startsAt != null && queue.startsAt > now) candidates.push(queue.startsAt);
  if (queue.stopsAt != null && queue.stopsAt > now) candidates.push(queue.stopsAt);
  // Only inspect a bounded week. Local Date arithmetic preserves DST/day transitions.
  for (let day = 0; day <= 8; day++) {
    for (const time of ['00:00', queue.windowStart, queue.windowEnd].filter(Boolean)) {
      const boundary = new Date(date);
      boundary.setDate(boundary.getDate() + day);
      const [hour, minute] = time.split(':').map(Number) as [number, number];
      boundary.setHours(hour, minute, 0, 0);
      const at = boundary.getTime();
      if (at <= now) continue;
      if (queueAvailable(queue, new Date(at - 1)) !== queueAvailable(queue, boundary))
        candidates.push(at);
    }
  }
  return candidates.length ? Math.min(...candidates) : null;
}
