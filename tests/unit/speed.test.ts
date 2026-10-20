import { describe, expect, it, vi } from 'vitest';
import {
  AdaptiveController,
  BandwidthLimiter,
  HostSlots,
  SpeedMeter,
  sleep,
} from '../../src/engine/speed/control';

describe('speed and adaptive concurrency', () => {
  it('aggregates recent byte samples and drops idle samples', () => {
    const meter = new SpeedMeter();
    meter.add(1000, 0);
    meter.add(2000, 1000);
    expect(meter.rate(1000)).toBe(3000);
    expect(meter.rate(5000)).toBe(0);
  });
  it('ramps quickly to the limit while throughput scales and backs off after throttling', () => {
    const controller = new AdaptiveController(16, 0);
    expect(controller.sample(2000, false, 2499)).toBe(2);
    expect(controller.sample(2000, false, 4000)).toBe(4);
    expect(controller.sample(4000, false, 8000)).toBe(8);
    expect(controller.sample(8000, false, 12000)).toBe(16);
    expect(controller.sample(16000, false, 16000)).toBe(16);
    expect(controller.sample(16000, false, 20000)).toBe(16);
    expect(controller.sample(0, true, 21000)).toBe(8);
    // A burst of failures from several ranges backs off only once.
    expect(controller.sample(0, true, 21100)).toBe(8);
    expect(controller.sample(8000, false, 30000)).toBe(8);
    expect(controller.sample(8000, false, 36000)).toBe(9);
  });
  it('settles on the best measured count instead of drifting down on a plateau', () => {
    const controller = new AdaptiveController(32, 0);
    controller.sample(1000, false, 4000); // 2 -> 4
    controller.sample(2000, false, 8000); // 4 -> 8
    expect(controller.sample(2100, false, 12000)).toBe(9); // small gain: keep 8, probe 9
    expect(controller.sample(2110, false, 16000)).toBe(8); // no gain: back to the best
    expect(controller.sample(2100, false, 20000)).toBe(8); // holds during cooldown
    expect(controller.sample(2100, false, 31000)).toBe(9); // re-probes, never drops below
    expect(controller.sample(2090, false, 35000)).toBe(8);
  });
  it('waits for the requested connections to open before judging them', () => {
    const controller = new AdaptiveController(8, 0);
    expect(controller.sample(1000, false, 4000)).toBe(4);
    expect(controller.sample(1000, false, 8000, 2)).toBe(4);
    expect(controller.sample(2000, false, 9000, 4)).toBe(4);
    expect(controller.sample(2000, false, 13000, 4)).toBe(8);
  });
  it('shares bandwidth reservations between concurrent readers', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new BandwidthLimiter(1000);
      const signal = new AbortController().signal;
      const finished: number[] = [];
      const a = limiter.consume(1000, signal).then(() => finished.push(1));
      const b = limiter.consume(1000, signal).then(() => finished.push(2));
      await vi.advanceTimersByTimeAsync(1000);
      expect(finished).toEqual([1]);
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all([a, b]);
      expect(finished).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('cancels waiters and releases host permits exactly once', async () => {
    const slots = new HostSlots(1);
    const signal = new AbortController().signal;
    const release = await slots.acquire('example.org', signal);
    const abort = new AbortController();
    const canceled = expect(slots.acquire('example.org', abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    abort.abort();
    await canceled;
    let acquired = false;
    const pending = slots.acquire('example.org', signal).then((releaseNext) => {
      acquired = true;
      return releaseNext;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);
    release();
    release();
    const releaseNext = await pending;
    expect(acquired).toBe(true);
    releaseNext();
    const paused = new AbortController();
    paused.abort();
    await expect(sleep(100, paused.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('releases the future bandwidth budget of canceled traffic before resumed transfers', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new BandwidthLimiter(1000);
      const controller = new AbortController();
      const canceled = expect(limiter.consume(10000, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
      controller.abort();
      await canceled;
      let finished = false;
      const resumed = limiter.consume(1000, new AbortController().signal).then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(finished).toBe(true);
      await resumed;
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('applies a new speed limit to remaining bytes without retaining the old delay', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new BandwidthLimiter(1000);
      const completed: number[] = [];
      const first = limiter
        .consume(2000, new AbortController().signal)
        .then(() => completed.push(1));
      const second = limiter
        .consume(3000, new AbortController().signal)
        .then(() => completed.push(2));
      await vi.advanceTimersByTimeAsync(500);
      limiter.rate = 3000;
      await vi.advanceTimersByTimeAsync(500);
      expect(completed).toEqual([1]);
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all([first, second]);
      expect(completed).toEqual([1, 2]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
