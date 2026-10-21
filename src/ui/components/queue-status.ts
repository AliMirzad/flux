import type { DownloadQueue } from '../../domain/model';
import { nextQueueBoundary, queueAvailable } from '../../application/queue';

export const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function hasSchedule(queue: DownloadQueue) {
  return (
    !!queue.windowStart ||
    !!queue.windowEnd ||
    queue.startsAt != null ||
    queue.stopsAt != null ||
    (!!queue.days && queue.days.length < 7)
  );
}

export function when(at: number) {
  return new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One plain-language line describing what a queue is doing right now. */
export function queueStatus(queue: DownloadQueue): {
  label: string;
  tone: 'live' | 'wait' | 'off';
} {
  if (queue.paused) return { label: 'Stopped', tone: 'off' };
  if (queue.manualRun) return { label: 'Running now', tone: 'live' };
  if (queueAvailable(queue))
    return { label: hasSchedule(queue) ? 'Running (in schedule)' : 'Running', tone: 'live' };
  const next = nextQueueBoundary(queue);
  return {
    label: next ? `Waiting · starts ${when(next)}` : 'Waiting · no upcoming start',
    tone: 'wait',
  };
}

export function scheduleSummary(queue: DownloadQueue) {
  if (!hasSchedule(queue)) return 'No schedule · starts as soon as files are added';
  const days =
    !queue.days || queue.days.length === 7
      ? 'Every day'
      : queue.days.length
        ? [...queue.days]
            .sort()
            .map((day) => dayNames[day])
            .join(', ')
        : 'No days';
  const time =
    queue.windowStart && queue.windowEnd
      ? `${queue.windowStart}–${queue.windowEnd}`
      : queue.windowStart
        ? `from ${queue.windowStart} until done`
        : queue.windowEnd
          ? `until ${queue.windowEnd}`
          : 'all day';
  return `${days} · ${time}`;
}
