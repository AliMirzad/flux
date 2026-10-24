import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createJob } from '../../src/application/jobs';
import { defaultSettings, type DownloadJob } from '../../src/domain/model';
import { runDownload } from '../../src/engine/runner';
import type { EngineOptions } from '../../src/engine/ports';
import { HostSlots } from '../../src/engine/speed/control';
import {
  TrafficBudget,
  TrafficLimitError,
  type TrafficRecord,
} from '../../src/engine/speed/budget';
import { completeBytes, missingRanges } from '../../src/engine/segmentation/ranges';
import { MemoryStore } from '../fixtures/memory-store';
import { fixtureHash, startFixture } from '../fixtures/server';

const MiB = 1024 * 1024;
let fixture: Awaited<ReturnType<typeof startFixture>>;
const settings = { ...defaultSettings, mode: 'manual' as const, maxConnections: 4 };

function setup(path: string, size = 3 * MiB, extras: Partial<EngineOptions> = {}) {
  const job = createJob(
    { url: `${fixture.url}${path}${path.includes('?') ? '&' : '?'}size=${size}` },
    settings,
    true,
  );
  job.state = 'PROBING';
  const store = new MemoryStore();
  const checkpoints: DownloadJob[] = [];
  const options: EngineOptions = {
    job,
    store,
    settings,
    signal: new AbortController().signal,
    checkpoint: async (snapshot) => {
      checkpoints.push(structuredClone(snapshot));
    },
    progress: () => {},
    allowLocalForTests: true,
    ...extras,
  };
  return { job, store, checkpoints, options };
}
function digest(store: MemoryStore) {
  return createHash('sha256').update(store.data).digest('hex');
}

beforeAll(async () => {
  fixture = await startFixture();
});
afterAll(async () => {
  await fixture.close();
});
beforeEach(() => {
  fixture.reset();
});

describe('real HTTP download engine', () => {
  it('completes an authorized range before allowance pause and resumes missing bytes across later windows', async () => {
    let now = 100;
    let record: TrafficRecord | undefined;
    const budget = new TrafficBudget(
      {
        load: async () => record,
        save: async (next) => {
          record = structuredClone(next);
        },
      },
      () => {},
      () => now,
    );
    await budget.configure(MiB, 1000);
    const { job, store, options } = setup('/range', 3 * MiB);
    options.settings = { ...settings, trafficLimit: MiB };
    options.checkAllowance = (signal) => budget.check(signal);
    options.reservePayload = (bytes, signal) => budget.consume(bytes, signal);
    options.accountPayload = (bytes, signal) => budget.consume(bytes, signal);
    for (let window = 0; window < 2; window++) {
      await expect(runDownload(options)).rejects.toBeInstanceOf(TrafficLimitError);
      expect(completeBytes(job.segments)).toBe((window + 1) * MiB);
      expect(record!.used).toBe(MiB);
      now += 1000;
      job.state = 'PROBING';
    }
    await runDownload(options);
    expect(job.state).toBe('ASSEMBLING');
    expect(job.sha256).toBe(fixtureHash(3 * MiB));
    expect(digest(store)).toBe(job.sha256);
    expect(fixture.stats.ranges.filter((range) => range !== 'bytes=0-0')).toEqual([
      'bytes=0-1048575',
      'bytes=1048576-2097151',
      'bytes=2097152-3145727',
    ]);
  });
  it('uses concurrent ranges and verifies actual stored output and checksum', async () => {
    const { job, store, checkpoints, options } = setup('/slow', 5 * MiB);
    await runDownload(options);
    expect(job.state).toBe('ASSEMBLING');
    expect(job.downloaded).toBe(5 * MiB);
    expect(digest(store)).toBe(fixtureHash(5 * MiB));
    expect(job.sha256).toBe(fixtureHash(5 * MiB));
    expect(completeBytes(job.segments)).toBe(5 * MiB);
    expect(missingRanges(5 * MiB, job.segments, MiB)).toEqual([]);
    expect(fixture.stats.maxActive).toBeGreaterThan(1);
    expect(fixture.stats.maxActive).toBeLessThanOrEqual(4);
    expect(store.maxWrite).toBeLessThanOrEqual(MiB);
    expect(store.flushes).toBeGreaterThan(0);
    expect(checkpoints.at(-1)?.downloaded).toBe(5 * MiB);
    expect(fixture.stats.ifRanges.every((value) => value === '"fixture-v1"')).toBe(true);
  });

  it.each(['/ignored-range', '/no-range', '/no-length'])(
    'downloads %s as a safe single stream',
    async (path) => {
      const { job, store, options } = setup(path, MiB + 7);
      await runDownload(options);
      expect(job.state).toBe('ASSEMBLING');
      expect(job.resource?.ranges).toBe(false);
      expect(job.total).toBe(MiB + 7);
      expect(digest(store)).toBe(fixtureHash(MiB + 7));
    },
  );

  it('restarts unsafe ranged responses as one clean stream', async () => {
    const { job, store, options } = setup('/bad-range');
    await runDownload(options);
    expect(job.state).toBe('ASSEMBLING');
    expect(job.resource?.ranges).toBe(false);
    expect(job.note).toMatch(/unsafe|single stream/i);
    expect(digest(store)).toBe(fixtureHash(3 * MiB));
  });

  it.each(['/disconnect', '/429', '/503'])(
    'recovers interrupted or throttled chunk %s',
    async (path) => {
      const { job, store, options } = setup(path);
      await runDownload(options);
      expect(job.retries).toBeGreaterThan(0);
      expect(digest(store)).toBe(fixtureHash(3 * MiB));
      expect(job.state).toBe('ASSEMBLING');
    },
  );

  it('preserves only flushed completed ranges and resumes them after recreation', async () => {
    const controller = new AbortController();
    const { job, store, checkpoints, options } = setup('/slow', 6 * MiB, {
      signal: controller.signal,
    });
    options.checkpoint = async (snapshot) => {
      checkpoints.push(structuredClone(snapshot));
      if (snapshot.segments.length === 1) controller.abort();
    };
    await expect(runDownload(options)).rejects.toMatchObject({ name: 'AbortError' });
    const saved = checkpoints.findLast((snapshot) => snapshot.segments.length > 0)!;
    expect(saved.segments.length).toBeGreaterThan(0);
    expect(saved.downloaded).toBeLessThan(6 * MiB);
    const retained = saved.segments.map((s) => `bytes=${s.start}-${s.end}`);
    fixture.reset();
    saved.state = 'PROBING';
    await runDownload({
      ...options,
      job: saved,
      signal: new AbortController().signal,
      checkpoint: async () => {},
    });
    expect(saved.state).toBe('ASSEMBLING');
    expect(digest(store)).toBe(fixtureHash(6 * MiB));
    for (const range of retained) expect(fixture.stats.ranges).not.toContain(range);
    expect(job.downloaded).toBeGreaterThan(0);
  });

  it('revalidates remote ETag and safely discards incompatible partial ranges', async () => {
    const controller = new AbortController();
    const { job, store, options } = setup('/etag', 4 * MiB, { signal: controller.signal });
    options.checkpoint = async (snapshot) => {
      if (snapshot.segments.length) controller.abort();
    };
    await expect(runDownload(options)).rejects.toMatchObject({ name: 'AbortError' });
    fixture.setVersion('/etag', 2);
    job.state = 'PROBING';
    try {
      await runDownload({
        ...options,
        signal: new AbortController().signal,
        checkpoint: async () => {},
      });
      expect(job.note).toMatch(/changed|Restarted/i);
      expect(job.sha256).toBe(digest(store));
      expect(job.sha256).not.toBe(fixtureHash(4 * MiB));
      expect(job.resource?.etag).toBe('"fixture-v2"');
    } finally {
      fixture.setVersion('/etag', 1);
    }
  });

  it('refuses corrupted local resume data', async () => {
    const { job, store, options } = setup('/range');
    await runDownload(options);
    store.data[100]! ^= 0xff;
    job.state = 'PROBING';
    await expect(runDownload(options)).rejects.toThrow(/integrity/i);
    expect(job.state).not.toBe('ASSEMBLING');
  });

  it('refuses network corruption when an expected SHA-256 was supplied', async () => {
    const { job, options } = setup('/corrupt');
    job.expectedHash = fixtureHash(3 * MiB);
    await expect(runDownload(options)).rejects.toThrow(/SHA-256/);
    expect(job.sha256).toBeNull();
    expect(job.state).not.toBe('ASSEMBLING');
  });

  it.each(['/range', '/no-range'])(
    'rejects silently corrupted stored bytes from %s without a supplied checksum',
    async (path) => {
      class CorruptingStore extends MemoryStore {
        corrupted = false;
        closed = false;
        override async write(offset: number, bytes: Uint8Array) {
          await super.write(offset, bytes);
          if (!this.corrupted && offset <= 1234 && offset + bytes.length > 1234) {
            this.data[1234]! ^= 0xff;
            this.corrupted = true;
          }
        }
        override async close() {
          this.closed = true;
        }
      }
      const store = new CorruptingStore();
      const { job, options } = setup(path, MiB, { store });
      expect(job.expectedHash).toBeNull();
      await expect(runDownload(options)).rejects.toThrow(/integrity/i);
      expect(store.corrupted).toBe(true);
      expect(store.closed).toBe(true);
      expect(job.sha256).toBeNull();
      expect(job.state).not.toBe('ASSEMBLING');
    },
  );

  it.each(['/auth', '/expiring', '/redirect-loop'])(
    'reports actionable failure for inaccessible resource %s',
    async (path) => {
      const { job, options } = setup(path);
      await expect(runDownload(options)).rejects.toThrow();
      expect(job.state).not.toBe('ASSEMBLING');
    },
  );
  it.each(['/redirect', '/reject-range', '/probe-invalid'])(
    'downloads real-world compatibility case %s safely',
    async (path) => {
      const { job, store, options } = setup(path, MiB + 123);
      await runDownload(options);
      expect(job.state).toBe('ASSEMBLING');
      expect(job.sha256).toBe(fixtureHash(MiB + 123));
      expect(digest(store)).toBe(job.sha256);
      if (path === '/redirect') expect(job.resource?.finalUrl).toContain('/range');
      else expect(job.resource?.ranges).toBe(false);
    },
  );

  it('fails quota exhaustion without approving an incomplete export', async () => {
    const store = new MemoryStore(64 * 1024);
    const { job, options } = setup('/range', 3 * MiB, { store });
    await expect(runDownload(options)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(job.state).not.toBe('ASSEMBLING');
    expect(job.sha256).toBeNull();
    expect(job.segments).toHaveLength(0);
  });

  it('never approves a repeatedly truncated range as a complete file', async () => {
    const { job, options } = setup('/truncated', MiB);
    await expect(runDownload(options)).rejects.toThrow();
    expect(job.state).not.toBe('ASSEMBLING');
    expect(job.sha256).toBeNull();
    expect(job.segments).toHaveLength(0);
    expect(job.retries).toBe(4);
  });

  it('shares per-host slots across concurrent independent downloads', async () => {
    const slots = new HostSlots(2);
    const acquireHost: NonNullable<EngineOptions['acquireHost']> = (host, signal) =>
      slots.acquire(host, signal);
    const a = setup('/slow', 3 * MiB, { acquireHost });
    const b = setup('/slow', 3 * MiB + 9, { acquireHost });
    await Promise.all([runDownload(a.options), runDownload(b.options)]);
    expect(fixture.stats.maxActive).toBeLessThanOrEqual(2);
    expect(digest(a.store)).toBe(fixtureHash(3 * MiB));
    expect(digest(b.store)).toBe(fixtureHash(3 * MiB + 9));
  });

  it('verifies an empty resource through the standards-correct 416 probe response', async () => {
    const { job, store, options } = setup('/range', 0);
    await runDownload(options);
    expect(job.state).toBe('ASSEMBLING');
    expect(job.total).toBe(0);
    expect(job.downloaded).toBe(0);
    expect(job.segments).toEqual([]);
    expect(store.data.length).toBe(0);
    expect(job.sha256).toBe(fixtureHash(0));
  });

  it('groups faster connections into bounded larger work while preserving exact coverage', async () => {
    const { job, store, options } = setup('/range', 12 * MiB);
    job.maxConnections = 1;
    await runDownload(options);
    expect(job.segments.some((segment) => segment.end - segment.start + 1 > MiB)).toBe(true);
    expect(job.segments.every((segment) => segment.end - segment.start + 1 <= 16 * MiB)).toBe(true);
    expect(completeBytes(job.segments)).toBe(12 * MiB);
    expect(missingRanges(12 * MiB, job.segments, MiB)).toEqual([]);
    expect(digest(store)).toBe(fixtureHash(12 * MiB));
  });

  it('discards old ranged content when HTTP identity changes after probing', async () => {
    const { job, store, options } = setup('/changing-etag');
    await runDownload(options);
    expect(job.state).toBe('ASSEMBLING');
    expect(job.resource?.ranges).toBe(false);
    expect(job.note).toMatch(/unsafe|single stream/);
    expect(store.data[12345]).not.toBe((12345 * 31 + Math.floor(12345 / 251) * 17) % 256);
    expect(job.sha256).toBe(digest(store));
    expect(job.sha256).not.toBe(fixtureHash(3 * MiB));
  });

  it('does not commit a truncated single stream and retries cleanly from zero', async () => {
    const { job, store, options, checkpoints } = setup('/single-disconnect');
    await runDownload(options);
    expect(job.retries).toBe(1);
    expect(
      checkpoints
        .filter((snapshot) => !snapshot.sha256)
        .every((snapshot) => snapshot.segments.length === 0 || snapshot.downloaded === 3 * MiB),
    ).toBe(true);
    expect(job.state).toBe('ASSEMBLING');
    expect(digest(store)).toBe(fixtureHash(3 * MiB));
  });

  it('abandons incomplete single-stream bytes on pause and restarts them from zero', async () => {
    const controller = new AbortController();
    const { job, store, checkpoints, options } = setup('/single-slow', 2 * MiB, {
      signal: controller.signal,
    });
    options.progress = (snapshot) => {
      if (snapshot.downloaded > 0) controller.abort();
    };
    await expect(runDownload(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(job.segments).toEqual([]);
    expect(checkpoints.every((snapshot) => snapshot.downloaded === 0)).toBe(true);
    job.state = 'PROBING';
    fixture.reset();
    await runDownload({ ...options, signal: new AbortController().signal, progress: () => {} });
    expect(digest(store)).toBe(fixtureHash(2 * MiB));
    expect(fixture.stats.ranges).toEqual(['bytes=0-0']);
  });

  it('drains an outstanding asynchronous write before releasing the storage handle on abort', async () => {
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class DelayedStore extends MemoryStore {
      pending = 0;
      closed = false;
      closedWhileWriting = false;
      override async write(offset: number, bytes: Uint8Array) {
        this.pending++;
        started();
        await gate;
        try {
          await super.write(offset, bytes);
        } finally {
          this.pending--;
        }
      }
      override async close() {
        this.closedWhileWriting = this.pending > 0;
        this.closed = true;
      }
    }
    const store = new DelayedStore();
    const controller = new AbortController();
    const { job, options } = setup('/range', 3 * MiB, { store, signal: controller.signal });
    let settled = false;
    const run = runDownload(options).finally(() => {
      settled = true;
    });
    const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await writing;
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(store.closed).toBe(false);
    release();
    await rejected;
    expect(store.closed).toBe(true);
    expect(store.closedWhileWriting).toBe(false);
    expect(job.segments).toEqual([]);
  });

  it('closes partial storage even when durable metadata persistence fails', async () => {
    class TrackedStore extends MemoryStore {
      closed = false;
      override async close() {
        this.closed = true;
      }
    }
    const store = new TrackedStore();
    const { job, options } = setup('/range', MiB, {
      store,
      checkpoint: async () => {
        throw new DOMException('Metadata quota exceeded.', 'QuotaExceededError');
      },
    });
    await expect(runDownload(options)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(store.closed).toBe(true);
    expect(job.state).not.toBe('ASSEMBLING');
  });
  it('opens the full connection allowance in adaptive mode on a server that scales', async () => {
    const auto = { ...settings, mode: 'auto' as const, maxConnections: 8, perHost: 8 };
    const { job, store, options } = setup('/capped', 8 * MiB, { settings: auto });
    job.mode = 'auto';
    job.maxConnections = 8;
    await runDownload(options);
    expect(fixture.stats.maxActive).toBe(8);
    expect(digest(store)).toBe(fixtureHash(8 * MiB));
  });
});
