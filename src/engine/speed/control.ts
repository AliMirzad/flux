export function abortError() {
  return new DOMException('Operation paused.', 'AbortError');
}
export function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}
export async function sleep(ms: number, signal: AbortSignal) {
  checkAbort(signal);
  if (!Number.isFinite(ms) || ms < 0) throw new Error('Unsafe retry delay.');
  let remaining = ms;
  do {
    const portion = Math.min(2147483647, remaining);
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(done, portion);
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(abortError());
      };
      signal.addEventListener('abort', abort, { once: true });
    });
    remaining -= portion;
  } while (remaining > 0);
}
export class SpeedMeter {
  private samples: { at: number; bytes: number }[] = [];
  add(bytes: number, at = performance.now()) {
    const last = this.samples.at(-1);
    if (last && at - last.at < 100) last.bytes += bytes;
    else this.samples.push({ at, bytes });
    this.samples = this.samples.filter((s) => s.at >= at - 3000);
  }
  rate(at = performance.now()) {
    this.samples = this.samples.filter((s) => s.at >= at - 3000);
    if (!this.samples.length) return 0;
    return (
      this.samples.reduce((n, s) => n + s.bytes, 0) /
      (Math.max(250, at - this.samples[0]!.at) / 1000)
    );
  }
}
// FIFO pacing keeps a bounded pending read per connection and removes canceled work.
export class BandwidthLimiter {
  private current: {
    remaining: number;
    started: number;
    signal: AbortSignal;
    resolve: () => void;
    reject: (reason: unknown) => void;
    abort: () => void;
  } | null = null;
  private pending: NonNullable<BandwidthLimiter['current']>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private limit: number;
  constructor(rate = 0) {
    this.limit = rate;
  }
  get rate() {
    return this.limit;
  }
  set rate(value: number) {
    if (value === this.limit) return;
    if (this.current) {
      this.current.remaining = Math.max(
        0,
        this.current.remaining - ((performance.now() - this.current.started) / 1000) * this.limit,
      );
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.pending.unshift(this.current);
      this.current = null;
    }
    this.limit = value;
    this.advance();
  }
  private advance() {
    if (this.current) return;
    const item = this.pending.shift();
    if (!item) return;
    this.current = item;
    item.started = performance.now();
    const finish = () => {
      item.signal.removeEventListener('abort', item.abort);
      this.current = null;
      this.timer = null;
      item.resolve();
      this.advance();
    };
    if (this.limit <= 0) {
      finish();
      return;
    }
    const duration = (item.remaining / this.limit) * 1000;
    this.timer = setTimeout(
      duration > 2147483647
        ? () => {
            item.remaining = Math.max(
              0,
              item.remaining - ((performance.now() - item.started) / 1000) * this.limit,
            );
            this.current = null;
            this.timer = null;
            this.pending.unshift(item);
            this.advance();
          }
        : finish,
      Math.min(2147483647, duration),
    );
  }
  async consume(bytes: number, signal: AbortSignal) {
    checkAbort(signal);
    if (this.rate <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const item: NonNullable<BandwidthLimiter['current']> = {
        remaining: bytes,
        started: 0,
        signal,
        resolve,
        reject,
        abort: () => {
          signal.removeEventListener('abort', item.abort);
          if (this.current === item) {
            if (this.timer) clearTimeout(this.timer);
            this.timer = null;
            this.current = null;
          } else this.pending = this.pending.filter((x) => x !== item);
          reject(abortError());
          this.advance();
        },
      };
      signal.addEventListener('abort', item.abort, { once: true });
      this.pending.push(item);
      this.advance();
    });
  }
}
// Hill climbing with memory: probes upward, keeps a step only when it measurably helps and
// otherwise returns to the best measured count, so plateaus never ratchet the count down.
export class AdaptiveController {
  target: number;
  private best: number;
  private bestRate = 0;
  private growing = true;
  private last: number;
  private cooldown = 0;
  private failedUntil = 0;
  constructor(
    readonly max: number,
    now = performance.now(),
  ) {
    this.target = Math.max(1, Math.min(max, 2));
    this.best = this.target;
    this.last = now;
  }
  // `running` is how many connections are really open; a count that is not reached yet
  // (host slots taken, no ranges left) cannot be measured, so evaluation waits for it.
  sample(rate: number, failed = false, now = performance.now(), running = this.target) {
    if (failed) {
      // One back-off per burst: simultaneous failures of several ranges must not cascade to 1.
      if (now >= this.failedUntil) {
        this.target = Math.max(1, Math.floor(this.target / 2));
        this.best = this.target;
        this.bestRate = 0;
        this.growing = false;
        this.failedUntil = now + 5000;
        this.cooldown = now + 15000;
      }
      this.last = now;
      return this.target;
    }
    if (running < this.target) {
      this.last = now;
      return this.target;
    }
    // Speed samples cover three seconds; four leaves a settle second after each fine step.
    // Doubling shows a large gain even through a partly stale window, so it moves faster.
    if (now - this.last < (this.growing ? 2500 : 4000) || now < this.cooldown) return this.target;
    this.last = now;
    if (rate <= 0) return this.target;
    if (this.target === this.best) {
      // Fresh baseline at the best count before probing, since network conditions drift.
      this.bestRate = rate;
      return this.probe();
    }
    if (rate >= this.bestRate * (this.growing ? 1.1 : 1.03)) {
      this.best = this.target;
      this.bestRate = rate;
      return this.probe();
    }
    if (this.growing && rate >= this.bestRate * 1.03) {
      this.growing = false;
      this.best = this.target;
      this.bestRate = rate;
      return this.probe();
    }
    this.growing = false;
    this.target = this.best;
    this.cooldown = now + 15000;
    return this.target;
  }
  private probe() {
    if (this.target >= this.max) return this.target;
    const step = this.growing ? this.target : Math.max(1, Math.ceil(this.target / 8));
    this.target = Math.min(this.max, this.target + step);
    return this.target;
  }
}
export class HostSlots {
  private counts = new Map<string, number>();
  private waiters = new Set<() => void>();
  constructor(public limit = 8) {}
  async acquire(host: string, signal: AbortSignal): Promise<() => void> {
    while ((this.counts.get(host) ?? 0) >= this.limit) {
      checkAbort(signal);
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(abortError());
        };
        const cleanup = () => {
          this.waiters.delete(wake);
          signal.removeEventListener('abort', abort);
        };
        this.waiters.add(wake);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
    checkAbort(signal);
    this.counts.set(host, (this.counts.get(host) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.counts.set(host, Math.max(0, (this.counts.get(host) ?? 0) - 1));
      for (const wake of [...this.waiters]) wake();
    };
  }
}
