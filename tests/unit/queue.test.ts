import { describe, expect, it } from 'vitest';
import { createJob } from '../../src/application/jobs';
import {
  inTimeWindow,
  nextWindowBoundary,
  orderedQueue,
  queueAvailable,
  nextQueueBoundary,
} from '../../src/application/queue';
import { defaultSettings } from '../../src/domain/model';

describe('queue scheduling', () => {
  it('opens a start-only queue at its start time and closes a stop-only queue at its stop time', () => {
    const base = { id: 'q', name: 'Q', paused: false, maxActive: 1, speedLimit: 0 };
    const at = (hour: number, minute = 0) => new Date(2026, 9, 19, hour, minute);
    const startOnly = { ...base, windowStart: '02:00', windowEnd: '' };
    expect(queueAvailable(startOnly, at(1, 59))).toBe(false);
    expect(queueAvailable(startOnly, at(2))).toBe(true);
    expect(nextQueueBoundary(startOnly, at(1))).toBe(at(2).getTime());
    const stopOnly = { ...base, windowStart: '', windowEnd: '08:00' };
    expect(queueAvailable(stopOnly, at(7, 59))).toBe(true);
    expect(queueAvailable(stopOnly, at(8))).toBe(false);
  });
  it('runs a manually started queue regardless of its schedule until it is stopped', () => {
    const queue = {
      id: 'q',
      name: 'Q',
      paused: false,
      maxActive: 1,
      speedLimit: 0,
      windowStart: '22:00',
      windowEnd: '23:00',
      days: [],
    };
    const noon = new Date(2026, 9, 19, 12);
    expect(queueAvailable(queue, noon)).toBe(false);
    expect(queueAvailable({ ...queue, manualRun: true }, noon)).toBe(true);
    expect(nextQueueBoundary({ ...queue, manualRun: true }, noon)).toBeNull();
    expect(queueAvailable({ ...queue, manualRun: true, paused: true }, noon)).toBe(false);
  });
  it('assigns an overnight window to its opening weekday and finds the next selected week', () => {
    const queue = {
      id: 'night',
      name: 'Night',
      paused: false,
      maxActive: 1,
      speedLimit: 0,
      windowStart: '22:00',
      windowEnd: '06:00',
      days: [1],
    };
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour);
    expect(at(19, 22).getDay()).toBe(1);
    expect(queueAvailable(queue, at(19, 22))).toBe(true);
    expect(queueAvailable(queue, at(20, 5))).toBe(true);
    expect(queueAvailable(queue, at(20, 6))).toBe(false);
    expect(queueAvailable(queue, at(20, 23))).toBe(false);
    expect(nextQueueBoundary(queue, at(20, 5))).toBe(at(20, 6).getTime());
    expect(nextQueueBoundary(queue, at(20, 6))).toBe(at(26, 22).getTime());
    expect(nextQueueBoundary({ ...queue, days: [] }, at(19, 21))).toBeNull();
  });
  it('honors absolute starts/stops and all-day weekday boundaries without minute polling', () => {
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
    const queue = {
      id: 'fixed',
      name: 'Fixed',
      paused: false,
      maxActive: 1,
      speedLimit: 0,
      windowStart: '',
      windowEnd: '',
      days: [1],
      startsAt: at(19, 9),
      stopsAt: at(19, 17),
    };
    expect(nextQueueBoundary(queue, new Date(at(19, 8)))).toBe(at(19, 9));
    expect(queueAvailable(queue, new Date(at(19, 9)))).toBe(true);
    expect(nextQueueBoundary(queue, new Date(at(19, 9)))).toBe(at(19, 17));
    expect(queueAvailable(queue, new Date(at(19, 17)))).toBe(false);
    expect(nextQueueBoundary(queue, new Date(at(19, 17)))).toBeNull();
  });
  it('sorts eligible queued jobs by priority then explicit order and age', () => {
    const a = createJob({ url: 'https://example.org/a' });
    a.order = 2;
    const b = createJob({ url: 'https://example.org/b', priority: 5 });
    b.order = 100;
    const c = createJob({ url: 'https://example.org/c' });
    c.order = 1;
    const later = createJob({ url: 'https://example.org/later', scheduledAt: 200 });
    const paused = createJob({ url: 'https://example.org/paused' });
    paused.state = 'PAUSED';
    const input = [a, b, c, later, paused];
    expect(orderedQueue(input, 100).map((job) => job.id)).toEqual([b.id, c.id, a.id]);
    expect(input[0]).toBe(a);
    expect(orderedQueue([later], 200)).toEqual([later]);
  });
  it('handles ordinary and overnight execution windows', () => {
    const at = (hour: number, minute = 0) => new Date(2026, 1, 1, hour, minute);
    const daily = { ...defaultSettings, windowStart: '09:00', windowEnd: '17:00' };
    expect(inTimeWindow(daily, at(9))).toBe(true);
    expect(inTimeWindow(daily, at(16, 59))).toBe(true);
    expect(inTimeWindow(daily, at(17))).toBe(false);
    expect(inTimeWindow(daily, at(8, 59))).toBe(false);
    const overnight = { ...daily, windowStart: '22:00', windowEnd: '06:00' };
    expect(inTimeWindow(overnight, at(23))).toBe(true);
    expect(inTimeWindow(overnight, at(5))).toBe(true);
    expect(inTimeWindow(overnight, at(6))).toBe(false);
    expect(inTimeWindow(overnight, at(15))).toBe(false);
    expect(inTimeWindow(defaultSettings, at(12))).toBe(true);
  });
  it('validates externally supplied checksum and unsafe destination names', () => {
    expect(() => createJob({ url: 'https://example.org/file', expectedHash: 'invalid' })).toThrow(
      /SHA-256/,
    );
    const job = createJob({
      url: 'https://example.org/file',
      filename: '../CON.txt',
      expectedHash: 'AB'.repeat(32),
    });
    expect(job.filename).not.toContain('/');
    expect(job.expectedHash).toBe('ab'.repeat(32));
  });

  it('schedules the next opening or closing boundary at the exact local wall time', () => {
    const settings = { ...defaultSettings, windowStart: '09:00', windowEnd: '17:30' };
    const at = (day: number, hours: number, minutes = 0, seconds = 0, milliseconds = 0) =>
      new Date(2026, 1, day, hours, minutes, seconds, milliseconds);
    expect(nextWindowBoundary(settings, at(1, 8, 59, 59, 999))).toBe(at(1, 9).getTime());
    expect(nextWindowBoundary(settings, at(1, 9))).toBe(at(1, 17, 30).getTime());
    expect(nextWindowBoundary(settings, at(1, 17, 29, 59, 999))).toBe(at(1, 17, 30).getTime());
    expect(nextWindowBoundary(settings, at(1, 17, 30))).toBe(at(2, 9).getTime());
    expect(nextWindowBoundary(settings, at(1, 23, 59))).toBe(at(2, 9).getTime());
  });

  it('finds both boundaries of an overnight window across midnight', () => {
    const settings = { ...defaultSettings, windowStart: '22:15', windowEnd: '06:45' };
    const at = (day: number, hours: number, minutes = 0) => new Date(2026, 1, day, hours, minutes);
    expect(nextWindowBoundary(settings, at(1, 5))).toBe(at(1, 6, 45).getTime());
    expect(nextWindowBoundary(settings, at(1, 6, 45))).toBe(at(1, 22, 15).getTime());
    expect(nextWindowBoundary(settings, at(1, 12))).toBe(at(1, 22, 15).getTime());
    expect(nextWindowBoundary(settings, at(1, 22, 15))).toBe(at(2, 6, 45).getTime());
    expect(nextWindowBoundary(settings, at(1, 23, 59))).toBe(at(2, 6, 45).getTime());
  });

  it('creates no wakeup for disabled or all-day execution windows', () => {
    expect(nextWindowBoundary(defaultSettings)).toBeNull();
    expect(nextWindowBoundary({ ...defaultSettings, windowStart: '09:00' })).toBeNull();
    expect(
      nextWindowBoundary({ ...defaultSettings, windowStart: '09:00', windowEnd: '09:00' }),
    ).toBeNull();
  });
});
