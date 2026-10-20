import { checkAbort } from './control';

export interface TrafficRecord {
  periodStart: number;
  periodMs: number;
  used: number;
}
export interface TrafficState {
  used: number;
  limit: number;
  resetsAt: number;
}
export class TrafficLimitError extends Error {
  constructor(public resetsAt: number) {
    super(
      'Download allowance reached. Stored ranges are retained until the next allowance window.',
    );
  }
}
/** One shared durable allowance. At most 1 MiB of unused credit is reserved across all connections. */
export class TrafficBudget {
  private record: TrafficRecord | null = null;
  private credit = 0;
  private limit = 0;
  private periodMs = 24 * 3600000;
  private pending: Promise<unknown> = Promise.resolve();
  private lastUpdate = -Infinity;
  constructor(
    private storage: {
      load(): Promise<TrafficRecord | undefined>;
      save(record: TrafficRecord): Promise<void>;
    },
    private update: (state: TrafficState) => void = () => {},
    private now = () => Date.now(),
  ) {}
  configure(limit: number, periodMs: number) {
    const operation = this.pending.then(async () => {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 0 ||
        !Number.isSafeInteger(periodMs) ||
        periodMs < 1
      )
        throw new Error('Invalid download allowance.');
      this.limit = limit;
      this.periodMs = periodMs;
      await this.window();
      this.emit(true);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
  private async window() {
    if (!this.limit) return;
    this.record ??= (await this.storage.load()) ?? null;
    if (
      this.record &&
      (!Number.isSafeInteger(this.record.used) ||
        this.record.used < 0 ||
        !Number.isSafeInteger(this.record.periodStart) ||
        !Number.isSafeInteger(this.record.periodMs) ||
        this.record.periodMs < 1)
    )
      throw new Error('Stored download allowance data is invalid.');
    const periodStart = Math.floor(this.now() / this.periodMs) * this.periodMs;
    if (
      !this.record ||
      this.record.periodMs !== this.periodMs ||
      this.record.periodStart !== periodStart
    ) {
      const record = { periodStart, periodMs: this.periodMs, used: 0 };
      await this.storage.save(record);
      this.record = record;
      this.credit = 0;
    }
  }
  private emit(force = false) {
    if (!force && this.now() - this.lastUpdate < 1000) return;
    this.lastUpdate = this.now();
    this.update({
      used: this.record?.used ?? 0,
      limit: this.limit,
      resetsAt: this.record ? this.record.periodStart + this.record.periodMs : 0,
    });
  }
  report() {
    this.emit(true);
  }
  async check(signal: AbortSignal) {
    const operation = this.pending.then(async () => {
      checkAbort(signal);
      if (!this.limit) return;
      await this.window();
      checkAbort(signal);
      if (this.record!.used - this.credit >= this.limit) {
        this.emit(true);
        throw new TrafficLimitError(this.record!.periodStart + this.record!.periodMs);
      }
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }
  async consume(bytes: number, signal: AbortSignal) {
    const operation = this.pending.then(async () => {
      checkAbort(signal);
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid traffic accounting.');
      if (!this.limit || !bytes) return;
      await this.window();
      checkAbort(signal);
      const record = this.record!;
      // Lowering the limit also constrains already-reserved credit.
      const actual = record.used - this.credit;
      if (actual + bytes > this.limit) {
        this.emit(true);
        throw new TrafficLimitError(record.periodStart + record.periodMs);
      }
      if (bytes > this.credit) {
        const available = Math.max(0, this.limit - record.used);
        const reservation = Math.min(available, Math.max(bytes - this.credit, 1024 * 1024));
        if (this.credit + reservation < bytes) {
          this.emit(true);
          throw new TrafficLimitError(record.periodStart + record.periodMs);
        }
        const next = { ...record, used: record.used + reservation };
        await this.storage.save(next);
        this.record = next;
        this.credit += reservation;
      }
      checkAbort(signal);
      this.credit -= bytes;
      this.emit();
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }
}
