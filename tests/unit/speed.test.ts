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
  it('starts at the allowed maximum and keeps it while the server copes', () => {
    const controller = new AdaptiveController(16, 0);
    expect(controller.target).toBe(16);
    expect(controller.sample(16000, false, 4000)).toBe(16);
    expect(controller.sample(15000, false, 8000)).toBe(16);
    expect(controller.sample(9000, false, 12000)).toBe(16);
  });
  it('walks down to the count a refusing server accepts and holds it', () => {
    const controller = new AdaptiveController(16, 0);
    // Ten of sixteen connections are refused while the others keep going.
    for (let open = 16; open > 6; open--) controller.sample(0, true, 21000, open);
    expect(controller.target).toBe(6);
    expect(controller.sample(3000, false, 40000)).toBe(6); // refused count stays avoided
    expect(controller.sample(3000, false, 90000)).toBe(8); // ceiling expired: probe again
    expect(controller.sample(4000, false, 94000)).toBe(10);
    expect(controller.sample(4000, false, 98000)).toBe(8); // no gain: back to the best
    expect(controller.sample(4000, false, 105000)).toBe(8); // cooldown
  });
  it('costs a single connection for a lone interruption', () => {
    const controller = new AdaptiveController(16, 0);
    expect(controller.sample(0, true, 1000, 16)).toBe(15);
  });
  it('waits for the requested connections to open before judging them', () => {
    const controller = new AdaptiveController(8, 0);
    expect(controller.sample(0, true, 0, 8)).toBe(7);
    expect(controller.sample(1000, false, 61000, 5)).toBe(7);
    expect(controller.sample(1000, false, 62000, 7)).toBe(7);
    expect(controller.sample(1000, false, 65000, 7)).toBe(8);
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
