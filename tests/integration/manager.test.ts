import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Repository } from '../../src/storage/repository';
import { createJob } from '../../src/application/jobs';
import { defaultSettings, type DownloadJob, type Settings } from '../../src/domain/model';
import type { WorkerEvent } from '../../src/messaging/protocol';
import type { ManagerAPI } from '../../src/application/contracts';
import { fixtureBytes, fixtureHash } from '../fixtures/server';

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  onerror: (() => void) | null = null;
  commands: { type: string; id?: string; job?: DownloadJob; settings?: Settings }[] = [];
  constructor() {
    ControlledWorker.instances.push(this);
  }
  postMessage(command: { type: string; id?: string; job?: DownloadJob }) {
    this.commands.push(command);
  }
  emit(event: WorkerEvent) {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>);
  }
}

let savedBytes: Uint8Array[];
let committed: boolean;
let aborted: boolean;
let picker: ReturnType<typeof vi.fn>;
const size = 16384;
const content = new Blob([Uint8Array.from(fixtureBytes(0, size)).buffer]);

beforeEach(() => {
  vi.resetModules();
  ControlledWorker.instances = [];
  savedBytes = [];
  committed = false;
  aborted = false;
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('Worker', ControlledWorker);
  vi.stubGlobal('chrome', undefined);
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object) => Promise<void>,
      ) => callback({}),
    },
    storage: {
      estimate: async () => ({ quota: 1024 ** 3, usage: 0 }),
      getDirectory: async () => ({
        getDirectoryHandle: async () => ({
          removeEntry: async () => {},
          getFileHandle: async () => ({ getFile: async () => content }),
        }),
      }),
    },
  });
  picker = vi.fn(async () => ({
    createWritable: async () =>
      new WritableStream<Uint8Array>({
        write(chunk) {
          savedBytes.push(chunk.slice());
        },
        close() {
          committed = true;
        },
        abort() {
          aborted = true;
        },
      }),
  }));
  vi.stubGlobal('window', { addEventListener: vi.fn(), showSaveFilePicker: picker });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function initialize(jobs: DownloadJob[] = []): Promise<ManagerAPI> {
  const repository = new Repository();
  for (const job of jobs) await repository.putJob(job);
  const { manager } = await import('../../src/application/client');
  await vi.waitFor(() => {
    expect(manager.getSnapshot().ready).toBe(true);
  });
  return manager;
}
function verifiedJob() {
  const job = createJob({ url: 'https://example.org/file' }, defaultSettings);
  job.state = 'ASSEMBLING';
  job.total = size;
  job.downloaded = size;
  job.sha256 = fixtureHash(size);
  job.segments = [{ start: 0, end: size - 1, hash: job.sha256 }];
  return job;
}

describe('batch import, named queues and address refresh', () => {
  it('keeps a due failed job idle without consuming attempts until both global and queue windows open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 20, 10));
      const queue = {
        id: 'retry-window',
        name: 'Retry window',
        paused: false,
        maxActive: 1,
        speedLimit: 0,
        windowStart: '11:00',
        windowEnd: '12:00',
      };
      await new Repository().putSettings({
        ...defaultSettings,
        retryAttempts: 2,
        retryDelaySeconds: 60,
        windowStart: '11:30',
        windowEnd: '12:30',
        queues: [queue],
      });
      const job = {
        ...createJob({ url: 'https://example.org/window-retry', queueId: queue.id }),
        state: 'FAILED' as const,
        retryFailure: { at: Date.now(), notBefore: Date.now() },
      };
      const manager = await initialize([job]);
      await vi.waitFor(() =>
        expect(manager.getSnapshot().jobs[0]?.queueRetryAt).toBeGreaterThan(0),
      );
      await vi.advanceTimersByTimeAsync(80 * 60000);
      expect(
        ControlledWorker.instances[0]!.commands.some((command) => command.type === 'start'),
      ).toBe(false);
      expect(manager.getSnapshot().jobs[0]?.queueRetries ?? 0).toBe(0);
      await vi.advanceTimersByTimeAsync(10 * 60000);
      await vi.waitFor(() =>
        expect(
          ControlledWorker.instances[0]!.commands.filter((command) => command.type === 'start'),
        ).toHaveLength(1),
      );
      expect(manager.getSnapshot().jobs[0]?.queueRetries).toBe(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('persists an automatic retry deadline, consumes attempts only on dispatch, exhausts its bound and permits a fresh manual retry', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 20, 10));
      await new Repository().putSettings({
        ...defaultSettings,
        retryAttempts: 2,
        retryDelaySeconds: 60,
      });
      const job = {
        ...createJob({ url: 'https://example.org/transient' }),
        state: 'FAILED' as const,
        retryFailure: { at: Date.now(), notBefore: Date.now() + 120000 },
      };
      const manager = await initialize([job]);
      const worker = ControlledWorker.instances[0]!;
      await vi.waitFor(() =>
        expect(manager.getSnapshot().jobs[0]?.queueRetryAt).toBe(job.retryFailure.notBefore),
      );
      expect((await new Repository().getJob(job.id))?.queueRetryAt).toBe(
        job.retryFailure.notBefore,
      );
      await expect(manager.add({ url: job.url })).rejects.toThrow('pending download');
      expect(await manager.addBatch([{ url: job.url }])).toEqual({ added: 0, skipped: 1 });
      await vi.advanceTimersByTimeAsync(119999);
      expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() =>
        expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(1),
      );
      expect(worker.commands.find((command) => command.type === 'start')?.job?.queueRetries).toBe(
        1,
      );
      const fail = async () => {
        const current = manager.getSnapshot().jobs[0]!;
        const failure = {
          ...current,
          state: 'FAILED' as const,
          retryFailure: { at: Date.now(), notBefore: Date.now() },
          error: 'Temporary server failure',
        };
        await new Repository().putJob(failure);
        worker.emit({ type: 'failed', job: failure });
        return failure;
      };
      const secondFailure = await fail();
      await vi.waitFor(() =>
        expect(manager.getSnapshot().jobs[0]?.queueRetryAt).toBe(
          secondFailure.retryFailure.at + 120000,
        ),
      );
      await vi.advanceTimersByTimeAsync(120000);
      await vi.waitFor(() =>
        expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(2),
      );
      expect(manager.getSnapshot().jobs[0]?.queueRetries).toBe(2);
      await fail();
      await vi.waitFor(() => expect(manager.getSnapshot().jobs[0]?.state).toBe('FAILED'));
      expect(manager.getSnapshot().jobs[0]?.queueRetryAt).toBeNull();
      await vi.advanceTimersByTimeAsync(86400000);
      expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(2);
      await manager.action(job.id, 'retry');
      expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(3);
      expect(manager.getSnapshot().jobs[0]?.queueRetries).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('does not lose a failure event delivered while the queue pump is dispatching a worker', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 20, 10));
      await new Repository().putSettings({
        ...defaultSettings,
        retryAttempts: 1,
        retryDelaySeconds: 60,
      });
      const original = ControlledWorker.prototype.postMessage;
      let failed = false;
      vi.spyOn(ControlledWorker.prototype, 'postMessage').mockImplementation(function (
        this: ControlledWorker,
        command,
      ) {
        original.call(this, command);
        if (command.type === 'start' && command.job && !failed) {
          failed = true;
          this.emit({
            type: 'failed',
            job: {
              ...command.job,
              state: 'FAILED',
              retryFailure: { at: Date.now(), notBefore: Date.now() },
            },
          });
        }
      });
      const manager = await initialize();
      await manager.add({ url: 'https://example.org/fast-failure' });
      await vi.waitFor(() =>
        expect(manager.getSnapshot().jobs[0]?.queueRetryAt).toBeGreaterThan(Date.now()),
      );
      const due = manager.getSnapshot().jobs[0]!.queueRetryAt!;
      await vi.advanceTimersByTimeAsync(due - Date.now());
      await vi.waitFor(() =>
        expect(
          ControlledWorker.instances[0]!.commands.filter((command) => command.type === 'start'),
        ).toHaveLength(2),
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('cancels every scheduled retry with pause-all, including after durable reopen, and leaves permanent failures untouched', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 20, 10));
      await new Repository().putSettings({
        ...defaultSettings,
        retryAttempts: 3,
        retryDelaySeconds: 60,
      });
      const job = {
        ...createJob({ url: 'https://example.org/persisted' }),
        state: 'FAILED' as const,
        queueRetries: 1,
        queueRetryAt: Date.now() + 30000,
        retryFailure: { at: Date.now() - 90000, notBefore: Date.now() },
      };
      const permanent = {
        ...createJob({ url: 'https://example.org/login' }),
        state: 'FAILED' as const,
        error: 'HTTP 401',
        retryFailure: null,
      };
      const manager = await initialize([job, permanent]);
      await vi.waitFor(() =>
        expect(manager.getSnapshot().jobs.find((item) => item.id === job.id)?.queueRetryAt).toBe(
          job.queueRetryAt,
        ),
      );
      await manager.pauseAll();
      const stored = await new Repository().getJob(job.id);
      expect(stored?.queueRetryAt).toBeNull();
      expect(stored?.retryFailure).toBeNull();
      await vi.advanceTimersByTimeAsync(86400000);
      expect(
        ControlledWorker.instances[0]!.commands.some((command) => command.type === 'start'),
      ).toBe(false);
      expect(manager.getSnapshot().jobs.find((item) => item.id === permanent.id)?.state).toBe(
        'FAILED',
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('retains a completed file and its verified checkpoints when included in bulk cancellation', async () => {
    const completed = { ...verifiedJob(), state: 'COMPLETED' as const, exported: true };
    const manager = await initialize([completed]);
    await manager.action(completed.id, 'cancel');
    const stored = await new Repository().getJob(completed.id);
    expect(stored?.state).toBe('COMPLETED');
    expect(stored?.sha256).toBe(completed.sha256);
    expect(stored?.segments).toEqual(completed.segments);
    expect(stored?.downloaded).toBe(size);
  });
  it('wakes a due periodic queue at the next global opening even when all earlier jobs are already verified', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 20, 18));
      const job = verifiedJob();
      job.queueId = 'global-repeat';
      await new Repository().putSettings({
        ...defaultSettings,
        windowStart: '09:00',
        windowEnd: '17:00',
        queues: [
          {
            id: 'global-repeat',
            name: 'Global repeat',
            paused: false,
            maxActive: 1,
            speedLimit: 0,
            windowStart: '',
            windowEnd: '',
            repeatMinutes: 1,
            nextRunAt: Date.now() - 60000,
          },
        ],
      });
      await initialize([job]);
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
      expect(
        ControlledWorker.instances[0]!.commands.filter((command) => command.type === 'start'),
      ).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(new Date(2026, 9, 21, 9).getTime() - Date.now());
      await vi.waitFor(() =>
        expect(
          ControlledWorker.instances[0]!.commands.filter((command) => command.type === 'start'),
        ).toHaveLength(1),
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('restarts active streams with the new allowance rather than leaving earlier requests outside the new budget', async () => {
    const manager = await initialize();
    await manager.add({ url: 'https://example.org/live-allowance' });
    const worker = ControlledWorker.instances[0]!;
    const job = manager.getSnapshot().jobs[0]!;
    const changing = manager.updateSettings({ ...defaultSettings, trafficLimit: 1024 * 1024 });
    await vi.waitFor(() =>
      expect(worker.commands.filter((command) => command.type === 'pause')).toHaveLength(1),
    );
    worker.emit({ type: 'paused', job: { ...job, state: 'PAUSED' } });
    await changing;
    const starts = worker.commands.filter((command) => command.type === 'start');
    expect(starts).toHaveLength(2);
    expect(starts[1]!.settings?.trafficLimit).toBe(1024 * 1024);
  });
  it('emits one queue completion notification and does not request notification access again while stopping the finished queue', async () => {
    const request = vi.fn(async (_options: { permissions?: string[]; origins?: string[] }) => true);
    const notify = vi.fn(async (_options: { message: string }) => 'queue-notification');
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension',
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      permissions: { request, contains: vi.fn(async () => true) },
      notifications: { create: notify },
      alarms: { create: vi.fn(async () => {}) },
    });
    const manager = await initialize();
    await manager.updateSettings({ ...defaultSettings, notifications: true });
    await manager.saveQueue({
      id: 'notify',
      name: 'Notify queue',
      paused: false,
      maxActive: 2,
      speedLimit: 0,
      windowStart: '',
      windowEnd: '',
      notifyOnComplete: true,
      stopOnComplete: true,
    });
    await manager.addBatch([
      { url: 'https://example.org/notify1', queueId: 'notify' },
      { url: 'https://example.org/notify2', queueId: 'notify' },
    ]);
    const worker = ControlledWorker.instances[0]!;
    for (const job of [...manager.getSnapshot().jobs])
      worker.emit({ type: 'done', job: { ...job, state: 'ASSEMBLING' } });
    await vi.waitFor(() => expect(manager.getSnapshot().settings.queues[0]?.paused).toBe(true));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatchObject({
      message: expect.stringContaining('Notify queue'),
    });
    expect(
      request.mock.calls.filter((call) =>
        (call[0] as { permissions?: string[] })?.permissions?.includes('notifications'),
      ),
    ).toHaveLength(1);
  });
  it('repeats a verified queue through a new atomic batch at its due time without discarding the old copy', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 20, 12));
      const job = verifiedJob();
      job.queueId = 'repeat';
      const queue = {
        id: 'repeat',
        name: 'Repeat',
        paused: false,
        maxActive: 1,
        speedLimit: 0,
        windowStart: '',
        windowEnd: '',
        repeatMinutes: 1,
      };
      await new Repository().putSettings({ ...defaultSettings, queues: [queue] });
      const manager = await initialize([job]);
      await vi.waitFor(() =>
        expect(manager.getSnapshot().settings.queues[0]?.nextRunAt).toBeGreaterThan(Date.now()),
      );
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(
        manager.getSnapshot().settings.queues[0]!.nextRunAt! - Date.now(),
      );
      await vi.waitFor(() =>
        expect(
          ControlledWorker.instances[0]!.commands.filter((command) => command.type === 'start'),
        ).toHaveLength(1),
      );
      const stored = await new Repository().getJobs();
      expect(stored).toHaveLength(2);
      expect(stored.find((item) => item.id === job.id)?.sha256).toBe(job.sha256);
      const repeated = stored.find((item) => item.id !== job.id)!;
      expect(repeated.url).toBe(job.url);
      expect(repeated.resource).toBeNull();
      expect(repeated.segments).toEqual([]);
      expect((await new Repository().getSettings()).queues[0]!.nextRunAt).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('stops a completed queue only after every file is verified', async () => {
    const manager = await initialize();
    await manager.saveQueue({
      id: 'finish',
      name: 'Finish',
      paused: false,
      maxActive: 1,
      speedLimit: 0,
      windowStart: '',
      windowEnd: '',
      stopOnComplete: true,
    });
    await manager.add({ url: 'https://example.org/finish', queueId: 'finish' });
    const job = manager.getSnapshot().jobs[0]!;
    expect(manager.getSnapshot().settings.queues[0]!.paused).toBe(false);
    ControlledWorker.instances[0]!.emit({ type: 'done', job: { ...job, state: 'ASSEMBLING' } });
    await vi.waitFor(() => expect(manager.getSnapshot().settings.queues[0]!.paused).toBe(true));
    expect((await new Repository().getSettings()).queues[0]!.paused).toBe(true);
  });
  it('retains allowance pauses through automatic recovery and resumes at their exact reset event', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(100000);
      const job = createJob({ url: 'https://example.org/budget', startPaused: true });
      job.budgetResumeAt = Date.now() + 1000;
      await new Repository().putSettings({
        ...defaultSettings,
        recovery: 'auto',
        trafficLimit: 1024 * 1024,
      });
      const manager = await initialize([job]);
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
      expect(
        ControlledWorker.instances[0]!.commands.filter((command) => command.type === 'start'),
      ).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(job.budgetResumeAt! - Date.now() - 1);
      expect(manager.getSnapshot().jobs[0]!.state).toBe('PAUSED');
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() =>
        expect(
          ControlledWorker.instances[0]!.commands.filter((command) => command.type === 'start'),
        ).toHaveLength(1),
      );
      expect(manager.getSnapshot().jobs[0]!.budgetResumeAt).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('manual pause-all cancels automatic allowance resumption', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      vi.setSystemTime(100000);
      const job = createJob({ url: 'https://example.org/budget-manual', startPaused: true });
      job.budgetResumeAt = Date.now() + 1000;
      await new Repository().putSettings({ ...defaultSettings, trafficLimit: 1024 * 1024 });
      const manager = await initialize([job]);
      await manager.pauseAll();
      await vi.advanceTimersByTimeAsync(1001);
      expect(
        ControlledWorker.instances[0]!.commands.filter((command) => command.type === 'start'),
      ).toHaveLength(0);
      expect(manager.getSnapshot().jobs[0]!.budgetResumeAt).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('validates the whole batch before committing and skips duplicate pending URLs', async () => {
    const manager = await initialize();
    await expect(
      manager.addBatch([
        { url: 'https://example.org/good', startPaused: true },
        { url: 'http://127.0.0.1/private' },
      ]),
    ).rejects.toThrow();
    expect(await new Repository().getJobs()).toHaveLength(0);
    const result = await manager.addBatch([
      { url: 'https://example.org/a', startPaused: true },
      { url: 'https://example.org/a' },
      { url: 'https://example.org/b', startPaused: true },
    ]);
    expect(result).toEqual({ added: 2, skipped: 1 });
    expect(manager.getSnapshot().jobs.every((job) => job.state === 'PAUSED')).toBe(true);
    expect(await new Repository().getJobs()).toHaveLength(2);
  });
  it('gates a stopped queue, enforces its concurrency, and lets another queue use remaining global capacity', async () => {
    const manager = await initialize();
    const queue = {
      id: 'night',
      name: 'Night downloads',
      paused: true,
      maxActive: 1,
      speedLimit: 0,
      windowStart: '',
      windowEnd: '',
    };
    await manager.saveQueue(queue);
    await manager.addBatch([
      { url: 'https://example.org/one', queueId: 'night' },
      { url: 'https://example.org/two', queueId: 'night' },
    ]);
    const worker = ControlledWorker.instances[0]!;
    expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(0);
    await manager.saveQueue({ ...queue, paused: false });
    expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(1);
    await manager.add({ url: 'https://elsewhere.org/free-slot' });
    expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(2);
    const active = manager
      .getSnapshot()
      .jobs.find((job) => job.queueId === 'night' && job.state === 'PROBING')!;
    worker.emit({ type: 'done', job: { ...active, state: 'ASSEMBLING' } });
    await vi.waitFor(() =>
      expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(3),
    );
  });
  it('refreshes a stopped source without discarding checkpoints or trusting the new URL identity', async () => {
    const job = verifiedJob();
    job.state = 'PAUSED';
    job.sha256 = null;
    job.resource = {
      finalUrl: job.url,
      size,
      ranges: true,
      etag: '"same"',
      modified: null,
      mime: 'application/octet-stream',
      filename: job.filename,
    };
    const manager = await initialize([job]);
    await manager.replaceSource(job.id, 'https://new.example.org/refreshed?signature=new');
    const refreshed = manager.getSnapshot().jobs[0]!;
    expect(refreshed.id).toBe(job.id);
    expect(refreshed.url).toContain('new.example.org');
    expect(refreshed.segments).toEqual(job.segments);
    expect(refreshed.resource).toEqual(job.resource);
    expect(refreshed.state).toBe('PAUSED');
    await manager.action(job.id, 'resume');
    const command = ControlledWorker.instances[0]!.commands.find(
      (command) => command.type === 'start',
    )!;
    expect(command.job?.resource?.etag).toBe('"same"');
    expect(command.job?.url).toBe(refreshed.url);
  });
  it('stopping a named queue aborts its active transfer and retains automatic queue ownership', async () => {
    const manager = await initialize();
    const queue = {
      id: 'stoppable',
      name: 'Stoppable',
      paused: false,
      maxActive: 1,
      speedLimit: 0,
      windowStart: '',
      windowEnd: '',
    };
    await manager.saveQueue(queue);
    await manager.add({ url: 'https://example.org/queue-stop', queueId: queue.id });
    const worker = ControlledWorker.instances[0]!;
    const stopping = manager.saveQueue({ ...queue, paused: true });
    await vi.waitFor(() =>
      expect(worker.commands.filter((command) => command.type === 'pause')).toHaveLength(1),
    );
    const active = manager.getSnapshot().jobs[0]!;
    worker.emit({ type: 'paused', job: { ...active, state: 'PAUSED' } });
    await stopping;
    expect(manager.getSnapshot().jobs[0]!.state).toBe('QUEUED');
    expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(1);
    await manager.saveQueue(queue);
    expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(2);
  });
});

describe('manager coordination and export', () => {
  it('publishes newly added jobs and resolves overlapping pause requests together', async () => {
    const manager = await initialize();
    await manager.add({ url: 'https://example.org/file' });
    const job = manager.getSnapshot().jobs[0]!;
    expect(job.url).toBe('https://example.org/file');
    const worker = ControlledWorker.instances[0]!;
    expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(1);
    const a = manager.action(job.id, 'pause');
    const b = manager.action(job.id, 'pause');
    await vi.waitFor(() =>
      expect(worker.commands.filter((command) => command.type === 'pause')).toHaveLength(1),
    );
    worker.emit({ type: 'paused', job: { ...job, state: 'PAUSED' } });
    await Promise.all([a, b]);
    expect(manager.getSnapshot().jobs[0]?.state).toBe('PAUSED');
  });

  it('rejects a pending Save As after removal without resurrecting the job', async () => {
    const job = verifiedJob();
    const manager = await initialize([job]);
    let choose!: (value: object) => void;
    picker.mockImplementation(
      () =>
        new Promise((resolve) => {
          choose = resolve;
        }),
    );
    const exporting = manager.exportFile(job.id);
    const rejected = expect(exporting).rejects.toThrow();
    await manager.action(job.id, 'remove');
    choose({ createWritable: vi.fn() });
    await rejected;
    expect(manager.getSnapshot().jobs).toEqual([]);
    expect(await new Repository().getJobs()).toEqual([]);
    expect(committed).toBe(false);
  });

  it('commits verified destination bytes before marking the export complete', async () => {
    const job = verifiedJob();
    const manager = await initialize([job]);
    await manager.exportFile(job.id);
    expect(committed).toBe(true);
    expect(aborted).toBe(false);
    expect(Buffer.concat(savedBytes)).toEqual(Buffer.from(fixtureBytes(0, size)));
    expect(manager.getSnapshot().jobs[0]?.state).toBe('COMPLETED');
    expect((await new Repository().getJobs())[0]?.exported).toBe(true);
  });

  it('aborts the destination transaction if final stored content no longer matches its checksum', async () => {
    const job = verifiedJob();
    job.sha256 = '0'.repeat(64);
    const manager = await initialize([job]);
    await expect(manager.exportFile(job.id)).rejects.toThrow(/SHA-256/);
    expect(committed).toBe(false);
    expect(aborted).toBe(true);
    expect(manager.getSnapshot().jobs[0]?.state).toBe('ASSEMBLING');
  });

  it('orders pause after pending startup persistence, then resolves both operations', async () => {
    const manager = await initialize();
    const { Repository: LoadedRepository } = await import('../../src/storage/repository');
    const original = LoadedRepository.prototype.putJob;
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(LoadedRepository.prototype, 'putJob').mockImplementation(async function (
      this: Repository,
      job: DownloadJob,
    ) {
      if (job.state === 'PROBING') {
        entered();
        await gate;
      }
      return original.call(this, job);
    });
    const adding = manager.add({ url: 'https://example.org/file' });
    await writing;
    const job = manager.getSnapshot().jobs[0]!;
    const pausing = manager.action(job.id, 'pause');
    const worker = ControlledWorker.instances[0]!;
    expect(worker.commands).toEqual([]);
    release();
    await adding;
    await vi.waitFor(() =>
      expect(worker.commands.map((command) => command.type)).toEqual(['start', 'pause']),
    );
    worker.emit({ type: 'paused', job: { ...job, state: 'PAUSED' } });
    await pausing;
    expect(manager.getSnapshot().jobs[0]?.state).toBe('PAUSED');
  });

  it('does not leave an unstarted failed job occupying an active slot', async () => {
    const manager = await initialize();
    const { Repository: LoadedRepository } = await import('../../src/storage/repository');
    const original = LoadedRepository.prototype.putJob;
    vi.spyOn(LoadedRepository.prototype, 'putJob').mockImplementation(async function (
      this: Repository,
      job: DownloadJob,
    ) {
      if (job.state === 'PROBING') throw new Error('Metadata persistence unavailable');
      return original.call(this, job);
    });
    await manager.add({ url: 'https://example.org/file' });
    const job = manager.getSnapshot().jobs[0]!;
    expect(job.state).toBe('FAILED');
    await manager.action(job.id, 'pause');
    expect(ControlledWorker.instances[0]?.commands).toEqual([]);
  });

  it('preserves the completed destination when saving export history fails', async () => {
    const job = verifiedJob();
    const manager = await initialize([job]);
    const { Repository: LoadedRepository } = await import('../../src/storage/repository');
    const original = LoadedRepository.prototype.putJob;
    vi.spyOn(LoadedRepository.prototype, 'putJob').mockImplementation(async function (
      this: Repository,
      snapshot: DownloadJob,
    ) {
      if (snapshot.state === 'COMPLETED') throw new Error('Metadata persistence unavailable');
      return original.call(this, snapshot);
    });
    await expect(manager.exportFile(job.id)).rejects.toThrow(/Metadata|history|persist/i);
    expect(committed).toBe(true);
    expect(manager.getSnapshot().jobs[0]?.state).toBe('COMPLETED');
    expect(aborted).toBe(false);
  });

  it('does not start a queued job removed while another startup was awaiting persistence', async () => {
    const a = createJob({ url: 'https://example.org/a' });
    a.order = 1;
    const b = createJob({ url: 'https://example.org/b' });
    b.order = 2;
    const { Repository: LoadedRepository } = await import('../../src/storage/repository');
    const original = LoadedRepository.prototype.putJob;
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(LoadedRepository.prototype, 'putJob').mockImplementation(async function (
      this: Repository,
      job: DownloadJob,
    ) {
      if (job.id === a.id && job.state === 'PROBING') {
        entered();
        await gate;
      }
      return original.call(this, job);
    });
    const initializing = initialize([a, b]);
    await writing;
    const manager = await initializing;
    await manager.action(b.id, 'remove');
    release();
    await vi.waitFor(() =>
      expect(
        ControlledWorker.instances[0]?.commands.filter((command) => command.type === 'start'),
      ).toHaveLength(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      ControlledWorker.instances[0]?.commands.some((command) => command.job?.id === b.id),
    ).toBe(false);
    expect((await new Repository().getJobs()).some((job) => job.id === b.id)).toBe(false);
  });

  it('pauses at the exact closing boundary and resumes at the next opening event', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      vi.setSystemTime(new Date(2026, 1, 1, 16, 59, 59));
      await new Repository().putSettings({
        ...defaultSettings,
        windowStart: '09:00',
        windowEnd: '17:00',
      });
      const manager = await initialize();
      await manager.add({ url: 'https://example.org/scheduled' });
      const worker = ControlledWorker.instances[0]!;
      const job = manager.getSnapshot().jobs[0]!;
      expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(1);
      const closing = new Date(2026, 1, 1, 17).getTime();
      await vi.advanceTimersByTimeAsync(closing - Date.now());
      expect(worker.commands.filter((command) => command.type === 'pause')).toHaveLength(1);
      worker.emit({ type: 'paused', job: { ...job, state: 'PAUSED' } });
      await vi.waitFor(() => expect(manager.getSnapshot().jobs[0]?.state).toBe('QUEUED'));
      expect(vi.getTimerCount()).toBe(1);
      const opening = new Date(2026, 1, 2, 9).getTime();
      await vi.advanceTimersByTimeAsync(opening - Date.now());
      await vi.waitFor(() =>
        expect(worker.commands.filter((command) => command.type === 'start')).toHaveLength(2),
      );
      expect(manager.getSnapshot().jobs[0]?.state).toBe('PROBING');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('has no scheduling timer when an execution window is closed and the queue is empty', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      vi.setSystemTime(new Date(2026, 1, 1, 8));
      await new Repository().putSettings({
        ...defaultSettings,
        windowStart: '09:00',
        windowEnd: '17:00',
      });
      await initialize();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
