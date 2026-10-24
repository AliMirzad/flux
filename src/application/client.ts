import type { ManagerAPI, Action } from './contracts';
import { createJob, downloadIdentity } from './jobs';
import {
  defaultSettings,
  runningStates,
  type DownloadJob,
  type NewDownload,
  type Settings,
  type Snapshot,
  type DownloadQueue,
} from '../domain/model';
import { transition } from '../domain/state';
import { Repository } from '../storage/repository';
import { cleanupOrphans, partialFile, removePartial } from '../storage/opfs';
import type { WorkerEvent } from '../messaging/protocol';
import { completeBytes } from '../engine/segmentation/ranges';
import {
  categoryFolderName,
  categoryOf,
  downloadsRelativePath,
  sanitizeFilename,
} from '../shared/files';
import { originPattern, safeError, trustedSender, validateUrl } from '../shared/security';
import {
  inTimeWindow,
  orderedQueue,
  nextWindowBoundary,
  queueAvailable,
  nextQueueBoundary,
} from './queue';
import { enableCompletionSound, playCompletionSound } from './feedback';
import { createSHA256 } from 'hash-wasm';
import { captureOrigins, excludedHost } from '../shared/capture';
import {
  PageTransfers,
  pageTransferKey,
  validPageGrant,
  type PageTransferGrant,
} from './page-transfer';
import { updateBrowserJob, browserNeedsReview } from '../domain/browser-download';
import { nextRetryAt, retryDue, hasPendingTransfer } from '../domain/retry';
import type { HlsReview } from '../engine/media/types';
import { HostPermissionError } from '../engine/network/policy';

const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
class Manager implements ManagerAPI {
  private snapshot: Snapshot = { jobs: [], settings: defaultSettings, ready: false, error: null };
  private listeners = new Set<() => void>();
  private repository = new Repository();
  private worker: Worker | null = null;
  private active = new Set<string>();
  private waiters = new Map<string, () => void>();
  private stops = new Map<string, Promise<void>>();
  private starting = new Map<string, Promise<void>>();
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private owned = false;
  private pumping = false;
  private pumpAgain = false;
  private holdQueue = false;
  private storageAt = 0;
  private releaseLock: (() => void) | null = null;
  private directory: FileSystemDirectoryHandle | null = null;
  private autoExports: Promise<unknown> = Promise.resolve();
  private armedQueues = new Set<string>();
  /** Jobs the user started explicitly; they run outside queue and download-window schedules. */
  private forced = new Set<string>();
  private browserTimer: ReturnType<typeof setTimeout> | null = null;
  private browserReading = false;
  private browserOffset = 0;
  private browserSamples = new Map<number, { at: number; bytes: number }>();
  private inspections = new Map<
    string,
    (reply: Extract<WorkerEvent, { type: 'hls-review' }>) => void
  >();
  private reviewedOrigins = new Map<string, { at: number; origins: string[] }>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  constructor() {
    void this.initialize().catch((e) => this.publish({ error: safeError(e), ready: true }));
  }
  private publish(patch: Partial<Snapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...patch, jobs: [...(patch.jobs ?? this.snapshot.jobs)] };
    this.listeners.forEach((fn) => fn());
  }
  private async initialize() {
    await navigator.locks.request('flux-manager-engine', { ifAvailable: true }, async (lock) => {
      if (!lock) {
        this.publish({
          ready: true,
          error:
            'Another manager tab owns the engine. Close this tab and use the existing manager.',
        });
        return;
      }
      this.owned = true;
      const settings = await this.repository.getSettings();
      const traffic = await this.repository.getTraffic();
      const jobs = await this.repository.getJobs();
      for (const job of jobs) {
        if (
          !job.pageFile &&
          job.note ===
            'Created by the page in your browser; it has no web address to download again.'
        ) {
          job.pageFile = true;
          await this.repository.putJob(job);
        }
        job.speed = 0;
        job.connections = 0;
        job.connectionSpeeds = [];
        if (job.engine === 'browser') continue;
        if (runningStates.has(job.state) && job.state !== 'ASSEMBLING') {
          job.state = job.state === 'EXPORTING' && job.sha256 ? 'ASSEMBLING' : 'PAUSED';
          job.downloaded = completeBytes(job.segments);
          job.note =
            'Recovered after the manager closed. Resume to verify stored data and reconnect.';
          job.timeline = [
            ...job.timeline.slice(-99),
            { at: Date.now(), event: 'Recovered interrupted job' },
          ];
          await this.repository.putJob(job);
        }
        if (
          settings.recovery === 'auto' &&
          !job.capturePending &&
          !job.budgetResumeAt &&
          (job.state === 'PAUSED' || job.state === 'WAITING_FOR_NETWORK')
        ) {
          job.state = 'QUEUED';
          await this.repository.putJob(job);
        }
      }
      this.worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        void this.onWorker(event.data).catch((e) => this.publish({ error: safeError(e) }));
      };
      this.worker.onerror = () => {
        void this.workerCrashed();
      };
      const periodMs = settings.trafficPeriodHours * 3600000;
      const periodStart = Math.floor(Date.now() / periodMs) * periodMs;
      this.publish({
        jobs,
        settings,
        ready: true,
        traffic: {
          used:
            traffic?.periodMs === periodMs && traffic.periodStart === periodStart
              ? traffic.used
              : 0,
          limit: settings.trafficLimit,
          resetsAt: periodStart + periodMs,
        },
      });
      this.directory = (await this.repository.getDestination()) ?? null;
      await this.refreshDestination();
      for (const job of jobs) if (job.state === 'ASSEMBLING') this.scheduleAutoSave(job.id);
      await this.refreshStorage();
      window.addEventListener('online', () => {
        for (const job of this.snapshot.jobs)
          if (job.state === 'WAITING_FOR_NETWORK')
            void this.action(job.id, 'resume').catch((e) => this.publish({ error: safeError(e) }));
      });
      window.addEventListener('beforeunload', (event) => {
        if (this.active.size || this.pageTransfers.receiving) {
          event.preventDefault();
        }
      });
      if (isExtension)
        chrome.runtime.onMessage.addListener((message, sender, respond) => {
          if (typeof message?.type === 'string' && message.type.startsWith('blob-')) {
            if (message.type === 'blob-ready') {
              if (sender.id === chrome.runtime.id && !sender.tab) respond({ ok: true });
              return;
            }
            if (sender.id !== chrome.runtime.id || !sender.tab) return;
            void this.pageTransfers.receive(message, sender).then(respond, (error) => {
              respond({ ok: false, error: safeError(error) });
            });
            return true;
          }
          if (
            !trustedSender(sender) &&
            !(
              sender.id === chrome.runtime.id &&
              !sender.tab &&
              sender.url === chrome.runtime.getURL('background.js')
            )
          )
            return;
          if (message?.type === 'manager-snapshot') {
            respond(this.snapshot);
            return;
          }
          if (message?.type === 'native-update') {
            this.applyBrowserUpdate(message.job, message.removed);
            respond({ ok: true });
            return;
          }
          if (
            message?.type === 'manager-command' &&
            typeof message.id === 'string' &&
            ['pause', 'resume', 'retry'].includes(message.action)
          ) {
            void this.action(message.id, message.action).then(
              () => respond({ ok: true }),
              (e) => respond({ ok: false, error: safeError(e) }),
            );
            return true;
          }
          if (message?.type === 'queue-wake') {
            void this.refreshQueue().then(
              () => respond({ ok: true }),
              (error) => respond({ ok: false, error: safeError(error) }),
            );
            return true;
          }
          if (message?.type === 'integration-settings') {
            void this.repository.getSettings().then(
              (settings) => {
                this.publish({ settings });
                respond({ ok: true });
              },
              (error) => respond({ error: safeError(error) }),
            );
            return true;
          }
        });
      await this.refreshQueue();
      await this.syncBrowserRows(true);
      await new Promise<void>((resolve) => {
        this.releaseLock = resolve;
      });
    });
  }
  private pageTransfers = new PageTransfers({
    authorize: async (token, sender) => {
      if (!this.owned || !this.snapshot.ready) throw new Error('The manager is not ready.');
      const key = pageTransferKey(token);
      const grant = (await chrome.storage.session.get(key))[key] as PageTransferGrant | undefined;
      if (!grant || !validPageGrant(grant, sender))
        throw new Error('Unknown transfer or wrong source document.');
      const settings = await this.repository.getSettings();
      const tab = await chrome.tabs.get(grant.tabId).catch(() => null);
      const origin = new URL(grant.source).origin;
      if (
        !settings.interception ||
        !tab?.url ||
        excludedHost(new URL(grant.source).hostname, settings.excludedHosts) ||
        excludedHost(new URL(tab.url).hostname, settings.excludedHosts) ||
        !(await chrome.permissions.contains({ origins: [origin + '/*'] }))
      )
        throw new Error('Page file access is no longer allowed.');
      return grant;
    },
    consume: (token) => chrome.storage.session.remove(pageTransferKey(token)),
    open: async () => {
      const id = crypto.randomUUID();
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle('partials', { create: true });
      const handle = await directory.getFileHandle(id, { create: true });
      const writable = await handle.createWritable();
      return {
        id,
        write: (bytes) => writable.write(bytes as Uint8Array<ArrayBuffer>),
        close: () => writable.close(),
        abort: () => writable.abort().catch(() => undefined),
      };
    },
    remove: removePartial,
    finish: async (id, grant, filename) => {
      const file = await partialFile(id);
      if (file.size !== grant.size) throw new Error('Received data did not match its size.');
      const hasher = await createSHA256();
      hasher.init();
      const reader = file.stream().getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          hasher.update(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const sha256 = hasher.digest('hex');
      const job = createJob({ url: grant.source, filename }, this.snapshot.settings);
      Object.assign(job, {
        id,
        pageFile: true,
        state: 'ASSEMBLING',
        total: file.size,
        downloaded: file.size,
        sha256,
        segments: file.size ? [{ start: 0, end: file.size - 1, hash: sha256 }] : [],
        note: 'Created by the page in your browser. Create it again on its website to download a new copy.',
        timeline: [
          { at: Date.now(), event: 'Received from the page' },
          { at: Date.now(), event: 'Verified' },
        ],
      });
      await this.repository.putJob(job);
      this.publish({ jobs: [job, ...this.snapshot.jobs] });
      this.scheduleAutoSave(job.id);
      return job.id;
    },
  });
  private ensureOwner() {
    if (!this.owned) throw new Error('Open the manager tab that owns the engine.');
    if (!this.snapshot.ready || !this.worker)
      throw new Error('The manager is still opening or needs to be reloaded.');
  }
  private applyBrowserUpdate(job?: DownloadJob, removed?: string) {
    if (removed) this.publish({ jobs: this.snapshot.jobs.filter((item) => item.id !== removed) });
    if (job?.engine === 'browser' && job.browser && Number.isSafeInteger(job.browser.id)) {
      const current = this.snapshot.jobs.some((item) => item.id === job.id);
      this.publish({
        jobs: current
          ? this.snapshot.jobs.map((item) => (item.id === job.id ? job : item))
          : [job, ...this.snapshot.jobs],
      });
    }
    this.scheduleBrowserPoll();
  }
  private scheduleBrowserPoll() {
    if (this.browserTimer) clearTimeout(this.browserTimer);
    this.browserTimer = null;
    if (
      !this.owned ||
      !isExtension ||
      !this.snapshot.jobs.some((job) => job.engine === 'browser' && job.state === 'DOWNLOADING')
    )
      return;
    this.browserTimer = setTimeout(() => {
      this.browserTimer = null;
      void this.syncBrowserRows().catch((error) => this.publish({ error: safeError(error) }));
    }, 1000);
  }
  private async syncBrowserRows(all = false) {
    if (!isExtension || this.browserReading) return;
    this.browserReading = true;
    try {
      const known = this.snapshot.jobs.filter(
        (job) =>
          job.engine === 'browser' &&
          job.browser &&
          !job.browser.erased &&
          (all ? !['COMPLETED', 'CANCELED'].includes(job.state) : job.state === 'DOWNLOADING'),
      );
      const selected = all
        ? known
        : [...known.slice(this.browserOffset), ...known.slice(0, this.browserOffset)].slice(0, 32);
      this.browserOffset = known.length ? (this.browserOffset + 32) % known.length : 0;
      for (let index = 0; index < selected.length; index += 32) {
        const batch = await Promise.allSettled(
          selected.slice(index, index + 32).map(async (job) => {
            const item = (await chrome.downloads.search({ id: job.browser!.id }))[0];
            if (!item || item.startTime !== job.browser!.startedAt) {
              const result = await chrome.runtime.sendMessage({
                type: 'native-command',
                id: job.id,
                action: 'refresh',
              });
              return result?.job as DownloadJob | undefined;
            }
            const next = updateBrowserJob(job, item);
            const at = performance.now();
            const sample = this.browserSamples.get(item.id);
            next.speed =
              next.state === 'DOWNLOADING' && sample
                ? Math.max(
                    0,
                    ((next.downloaded - sample.bytes) * 1000) / Math.max(1, at - sample.at),
                  )
                : 0;
            next.averageSpeed = (next.downloaded * 1000) / Math.max(1, Date.now() - next.createdAt);
            if (next.state === 'DOWNLOADING')
              this.browserSamples.set(item.id, { at, bytes: next.downloaded });
            else this.browserSamples.delete(item.id);
            return next;
          }),
        );
        const updates = new Map(
          batch.flatMap((result) =>
            result.status === 'fulfilled' && result.value
              ? [[result.value.id, result.value] as const]
              : [],
          ),
        );
        this.publish({
          jobs: this.snapshot.jobs.map((job) =>
            job.engine === 'browser' ? (updates.get(job.id) ?? job) : job,
          ),
        });
      }
    } finally {
      this.browserReading = false;
      this.scheduleBrowserPoll();
    }
  }
  private job(id: string) {
    const job = this.snapshot.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Download no longer exists.');
    return job;
  }
  private async persist(job: DownloadJob) {
    job.updatedAt = Date.now();
    await this.repository.putJob(job);
    this.publish();
  }
  private async refreshStorage() {
    const estimate = await navigator.storage.estimate();
    this.storageAt = Date.now();
    this.publish({ storage: { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } });
  }
  private async workerCrashed() {
    this.holdQueue = true;
    for (const [requestId, reply] of [...this.inspections])
      reply({
        type: 'hls-review',
        requestId,
        error: 'The transfer worker stopped. Reload the manager and review the stream again.',
      });
    for (const id of this.active) {
      const job = this.job(id);
      job.state = 'PAUSED';
      job.speed = 0;
      job.error = 'Transfer worker stopped. Reload the manager to recover durable checkpoints.';
    }
    this.active.clear();
    this.publish({ error: 'The transfer worker stopped. Reload to recover.' });
    for (const resolve of this.waiters.values()) resolve();
    this.waiters.clear();
  }
  private async onWorker(event: WorkerEvent) {
    if (event.type === 'hls-review') {
      this.inspections.get(event.requestId)?.(event);
      return;
    }
    if (event.type === 'traffic') {
      this.publish({ traffic: { used: event.used, limit: event.limit, resetsAt: event.resetsAt } });
      return;
    }
    if (event.type === 'redirect' || event.type === 'prepare-request') {
      try {
        const reply = await chrome.runtime.sendMessage({
          type: event.type === 'redirect' ? 'resolve-redirect' : 'prepare-request',
          url: event.from,
          location: event.location,
        });
        this.worker?.postMessage({ type: 'redirect-result', requestId: event.requestId, ...reply });
      } catch (error) {
        this.worker?.postMessage({
          type: 'redirect-result',
          requestId: event.requestId,
          error: safeError(error),
        });
      }
      return;
    }
    const index = this.snapshot.jobs.findIndex((j) => j.id === event.job.id);
    if (index < 0) return;
    this.snapshot.jobs[index] = event.job;
    if (event.type !== 'progress') {
      this.active.delete(event.job.id);
      this.waiters.get(event.job.id)?.();
      this.waiters.delete(event.job.id);
      if (event.type === 'done' && this.snapshot.settings.notifications && isExtension)
        if (
          !this.snapshot.settings.queues.find((queue) => queue.id === event.job.queueId)
            ?.notifyOnComplete
        )
          void chrome.notifications
            .create({
              type: 'basic',
              iconUrl: 'icon128.png',
              title: 'Flux · ready to save',
              message: event.job.filename,
            })
            .catch((e) => this.publish({ error: safeError(e) }));
      if (event.type === 'done' && this.snapshot.settings.completionSound) playCompletionSound();
      if (Date.now() - this.storageAt > 10000) await this.refreshStorage();
    }
    this.publish();
    if (event.type !== 'progress') void this.pump();
    if (event.type === 'done') this.scheduleAutoSave(event.job.id);
  }
  async add(input: NewDownload) {
    this.ensureOwner();
    const url = validateUrl(input.url);
    this.validateQueue(input.queueId);
    const job = createJob(input, this.snapshot.settings);
    if (isExtension) {
      const reviewed =
        input.media === 'hls'
          ? this.reviewedOrigins.get(JSON.stringify([url.href, job.media?.audioUrl ?? null]))
          : undefined;
      const origins = reviewed && Date.now() - reviewed.at < 300000 ? reviewed.origins : [];
      const granted = await chrome.permissions.request({
        origins: [
          ...new Set([
            url.origin,
            ...(job.media?.audioUrl ? [new URL(job.media.audioUrl).origin] : []),
            ...origins,
          ]),
        ].map((origin) => originPattern(validateUrl(origin).origin)),
      });
      if (!granted) throw new Error('Website access is required to download from this origin.');
    }
    if (
      this.snapshot.jobs.some(
        (j) =>
          downloadIdentity(j.url, j.media?.audioUrl) ===
            downloadIdentity(job.url, job.media?.audioUrl) &&
          hasPendingTransfer(j, this.snapshot.settings),
      )
    )
      throw new Error('This URL already has a pending download.');
    await this.repository.putJob(job);
    this.publish({ jobs: [job, ...this.snapshot.jobs] });
    await this.pump();
  }
  async inspectHls(
    raw: string,
    signal?: AbortSignal,
    rawAudio?: string,
    useBrowserCookies = false,
  ): Promise<HlsReview> {
    this.ensureOwner();
    if (!isExtension) throw new Error('HLS review requires the installed Chrome extension.');
    const url = validateUrl(raw).href;
    const audioUrl = rawAudio === undefined ? undefined : validateUrl(rawAudio).href;
    if (audioUrl && new URL(url).protocol === 'https:' && new URL(audioUrl).protocol === 'http:')
      throw new Error('An insecure HLS audio address was blocked.');
    if (
      !(await chrome.permissions.request({
        origins: [
          ...new Set([url, ...(audioUrl ? [audioUrl] : [])].map((value) => originPattern(value))),
        ],
      }))
    )
      throw new Error('Website access was declined.');
    if (signal?.aborted) throw new DOMException('Media review canceled.', 'AbortError');
    const requestId = crypto.randomUUID();
    const review = await new Promise<HlsReview>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.inspections.delete(requestId);
      };
      const stop = (error: Error) => {
        cleanup();
        this.worker?.postMessage({ type: 'cancel-hls-review', requestId });
        reject(error);
      };
      const abort = () => stop(new DOMException('Media review canceled.', 'AbortError'));
      const timer = setTimeout(
        () => stop(new DOMException('Media review timed out.', 'TimeoutError')),
        60000,
      );
      this.inspections.set(requestId, (reply) => {
        cleanup();
        if (reply.review) resolve(reply.review);
        else
          reject(
            reply.permissionOrigin
              ? new HostPermissionError(reply.permissionOrigin)
              : new Error(reply.error ?? 'Media review failed.'),
          );
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker!.postMessage({
        type: 'inspect-hls',
        requestId,
        url,
        audioUrl,
        useBrowserCookies,
      });
    });
    if (review.kind === 'media') {
      for (const key of new Set([
        JSON.stringify([url, audioUrl ?? null]),
        JSON.stringify([review.url, review.audioUrl ?? null]),
      ])) {
        if (!this.reviewedOrigins.has(key) && this.reviewedOrigins.size >= 16)
          this.reviewedOrigins.delete(this.reviewedOrigins.keys().next().value!);
        this.reviewedOrigins.set(key, { at: Date.now(), origins: review.origins });
      }
    }
    return review;
  }
  private validateQueue(id?: string) {
    if (id && id !== 'default' && !this.snapshot.settings.queues.some((queue) => queue.id === id))
      throw new Error('Select an existing download queue.');
  }
  async addBatch(inputs: NewDownload[]) {
    this.ensureOwner();
    if (!inputs.length || inputs.length > 500)
      throw new Error('Choose between 1 and 500 downloads.');
    const seen = new Set(
      this.snapshot.jobs
        .filter((job) => hasPendingTransfer(job, this.snapshot.settings))
        .map((job) => downloadIdentity(job.url, job.media?.audioUrl)),
    );
    const jobs: DownloadJob[] = [];
    for (const input of inputs) {
      this.validateQueue(input.queueId);
      const job = createJob(input, this.snapshot.settings);
      const identity = downloadIdentity(job.url, job.media?.audioUrl);
      if (!seen.has(identity)) {
        seen.add(identity);
        jobs.push(job);
      }
    }
    if (!jobs.length) return { added: 0, skipped: inputs.length };
    if (
      isExtension &&
      !(await chrome.permissions.request({
        origins: [
          ...new Set(
            jobs
              .flatMap((job) => [job.url, ...(job.media?.audioUrl ? [job.media.audioUrl] : [])])
              .map((value) => originPattern(value)),
          ),
        ],
      }))
    )
      throw new Error('Website access was declined. No downloads were added.');
    await this.repository.putJobs(jobs);
    this.publish({ jobs: [...jobs, ...this.snapshot.jobs] });
    await this.pump();
    return { added: jobs.length, skipped: inputs.length - jobs.length };
  }
  async replaceSource(id: string, rawUrl: string) {
    this.ensureOwner();
    const job = this.job(id);
    if (job.pageFile) throw new Error('Create this file again on its website.');
    if (
      !['PAUSED', 'FAILED', 'WAITING_FOR_NETWORK', 'QUEUED'].includes(job.state) ||
      this.active.has(id) ||
      this.starting.has(id)
    )
      throw new Error('Pause the unfinished download before refreshing its address.');
    const url = validateUrl(rawUrl);
    if (isExtension && !(await chrome.permissions.request({ origins: [originPattern(url.href)] })))
      throw new Error('Website access was declined. The original address was retained.');
    if (this.job(id) !== job || this.active.has(id) || this.starting.has(id))
      throw new Error('The download changed while requesting access. Pause it and retry.');
    job.url = url.href;
    job.queueRetryAt = null;
    job.retryFailure = null;
    job.queueRetries = 0;
    job.permissionOrigin = null;
    job.error = null;
    job.note =
      'Address refreshed. Resume will validate the new resource before reusing stored ranges.';
    if (job.state !== 'PAUSED') job.state = 'PAUSED';
    job.timeline = [
      ...job.timeline.slice(-99),
      { at: Date.now(), event: 'Source address refreshed; identity revalidation required' },
    ];
    await this.persist(job);
  }
  async saveQueue(queue: DownloadQueue) {
    this.ensureOwner();
    if (
      queue.id === 'default' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(queue.id) ||
      !queue.name.trim() ||
      queue.name.length > 60
    )
      throw new Error('Use a valid queue name and identifier.');
    const queues = this.snapshot.settings.queues.filter((item) => item.id !== queue.id);
    const existing = this.snapshot.settings.queues.find((item) => item.id === queue.id);
    const nextRunAt = queue.repeatMinutes
      ? existing?.repeatMinutes === queue.repeatMinutes
        ? existing.nextRunAt
        : null
      : null;
    if (queues.length >= 30) throw new Error('Create at most 30 queues.');
    await this.updateSettings({
      ...this.snapshot.settings,
      queues: [...queues, { ...queue, name: queue.name.trim(), nextRunAt }],
    });
  }
  async removeQueue(id: string) {
    this.ensureOwner();
    const assigned = this.snapshot.jobs.filter((job) => job.queueId === id);
    const priorHold = this.holdQueue;
    this.holdQueue = true;
    try {
      await Promise.all(assigned.map((job) => this.stop(job)));
      for (const original of assigned) {
        const job = this.job(original.id);
        job.queueId = 'default';
        job.queueRetryAt = null;
        job.retryFailure = null;
        await this.persist(job);
      }
      await this.updateSettings({
        ...this.snapshot.settings,
        queues: this.snapshot.settings.queues.filter((queue) => queue.id !== id),
      });
    } finally {
      this.holdQueue = priorHold;
      await this.pump();
    }
  }
  private async stop(job: DownloadJob) {
    const existing = this.stops.get(job.id);
    if (existing) return existing;
    const pending = (async () => {
      await this.starting.get(job.id);
      if (!this.active.has(job.id)) return;
      await new Promise<void>((resolve) => {
        this.waiters.set(job.id, resolve);
        this.worker?.postMessage({ type: 'pause', id: job.id });
      });
    })();
    this.stops.set(job.id, pending);
    try {
      await pending;
    } finally {
      this.stops.delete(job.id);
    }
  }
  async action(id: string, action: Action) {
    this.ensureOwner();
    let job = this.job(id);
    if (job.engine === 'browser') {
      const reply = await chrome.runtime.sendMessage({ type: 'native-command', id, action });
      if (reply?.error) throw new Error(reply.error);
      this.applyBrowserUpdate(reply?.job, reply?.removed);
      return;
    }
    if (action === 'show') {
      if (!isExtension || job.savedDownloadId == null)
        throw new Error('This file was not saved through the Downloads folder.');
      const item = (await chrome.downloads.search({ id: job.savedDownloadId }))[0];
      if (!item || item.state !== 'complete' || item.exists === false)
        throw new Error('The saved file was moved or deleted. Use Save file to export it again.');
      chrome.downloads.show(item.id);
      return;
    }
    if (action === 'cancel' && job.state === 'COMPLETED') return;
    if (job.pageFile && ['start', 'resume', 'retry'].includes(action))
      throw new Error('Create this file again on its website, or save the retained copy.');
    if (['pause', 'cancel', 'remove', 'resume', 'retry', 'start'].includes(action)) {
      const wasScheduled = job.queueRetryAt != null || !!job.retryFailure;
      job.queueRetryAt = null;
      job.retryFailure = null;
      if (['resume', 'retry', 'start'].includes(action)) job.queueRetries = 0;
      if (action === 'pause' && job.state === 'FAILED' && wasScheduled) {
        job.note = 'Automatic retry stopped. Retry manually to start another attempt.';
        await this.persist(job);
        void this.pump();
        return;
      }
    }
    if (isExtension && job.permissionOrigin && ['resume', 'retry', 'start'].includes(action)) {
      const origins = [originPattern(job.permissionOrigin)];
      // Access may already be granted elsewhere (popup); request() then needs no user gesture.
      if (
        !(await chrome.permissions.contains({ origins })) &&
        !(await chrome.permissions.request({ origins }))
      )
        throw new Error('Website access was declined.');
      job.permissionOrigin = null;
    }
    if (job.budgetResumeAt && ['pause', 'resume', 'retry', 'start'].includes(action)) {
      job.budgetResumeAt = null;
      await this.persist(job);
    }
    if (action === 'pause') {
      this.forced.delete(id);
      if (this.active.has(id) || this.starting.has(id)) {
        await this.stop(job);
        return;
      }
      if (['QUEUED', 'WAITING_FOR_NETWORK'].includes(job.state)) {
        transition(job, 'PAUSED');
        await this.persist(job);
      }
      return;
    }
    if (action === 'remove' || action === 'cancel') {
      const priorHold = this.holdQueue;
      this.holdQueue = true;
      try {
        await this.stop(job);
        job = this.job(id);
        if (job.state === 'EXPORTING') throw new Error('Wait for export to finish.');
        if (action === 'remove') {
          await removePartial(id);
          await this.repository.deleteJob(id);
          this.publish({ jobs: this.snapshot.jobs.filter((j) => j.id !== id) });
        } else {
          if (!['COMPLETED', 'CANCELED'].includes(job.state)) transition(job, 'CANCELED');
          await removePartial(id);
          if (job.media) {
            await this.repository.clearMediaCheckpoints(id);
            job.media = {
              kind: 'hls',
              ...(job.media.audioUrl
                ? { audioUrl: job.media.audioUrl, audioLabel: job.media.audioLabel }
                : {}),
            };
          }
          job.segments = [];
          job.downloaded = 0;
          job.sha256 = null;
          await this.persist(job);
        }
      } finally {
        this.holdQueue = priorHold;
        void this.pump();
      }
      return;
    }
    if (action === 'up' || action === 'down') {
      const peers = this.snapshot.jobs
        .filter((j) => j.state === 'QUEUED')
        .sort((a, b) => b.priority - a.priority || a.order - b.order);
      const idx = peers.findIndex((j) => j.id === id);
      const other = peers[idx + (action === 'up' ? -1 : 1)];
      if (other) {
        [job.order, other.order] = [other.order, job.order];
        [job.priority, other.priority] = [other.priority, job.priority];
        await this.repository.putJob(other);
        await this.persist(job);
      }
      return;
    }
    if (action === 'redownload') {
      if (job.pageFile)
        throw new Error(
          'Create this file again on its website. The page address is not a download link.',
        );
      await this.add({
        url: job.url,
        useBrowserCookies: job.useBrowserCookies,
        filename: job.filename,
        expectedHash: job.expectedHash ?? undefined,
        media: job.media?.kind,
        audioUrl: job.media?.audioUrl,
        audioLabel: job.media?.audioLabel,
      });
      return;
    }
    if (action === 'start') {
      job.scheduledAt = null;
      job.priority = 10;
      this.forced.add(id);
    }
    if (['PAUSED', 'FAILED', 'CANCELED', 'WAITING_FOR_NETWORK'].includes(job.state)) {
      job.capturePending = false;
      transition(job, 'QUEUED');
      job.error = null;
      await this.persist(job);
    } else if (job.state === 'QUEUED') await this.persist(job);
    await this.pump();
  }
  async pauseAll() {
    this.ensureOwner();
    this.holdQueue = true;
    try {
      await Promise.all(
        this.snapshot.jobs
          .filter(
            (j) =>
              this.active.has(j.id) ||
              (j.engine === 'browser' && j.state === 'DOWNLOADING') ||
              j.state === 'QUEUED' ||
              j.state === 'WAITING_FOR_NETWORK' ||
              !!j.budgetResumeAt,
          )
          .concat(this.snapshot.jobs.filter((j) => j.state === 'FAILED' && j.queueRetryAt != null))
          .map((j) => this.action(j.id, 'pause')),
      );
    } finally {
      this.holdQueue = false;
    }
  }
  async resumeAll() {
    for (const job of this.snapshot.jobs)
      if (
        ['PAUSED', 'WAITING_FOR_NETWORK', 'FAILED'].includes(job.state) &&
        !job.sha256 &&
        (job.engine !== 'browser' ||
          (job.browser?.canResume && !browserNeedsReview(job.browser.danger)))
      )
        await this.action(job.id, 'resume');
  }
  async updateSettings(settings: Settings) {
    this.ensureOwner();
    const renewAllowance =
      !settings.trafficLimit ||
      settings.trafficLimit > this.snapshot.settings.trafficLimit ||
      settings.trafficPeriodHours !== this.snapshot.settings.trafficPeriodHours;
    const allowanceChanged =
      settings.trafficLimit !== this.snapshot.settings.trafficLimit ||
      settings.trafficPeriodHours !== this.snapshot.settings.trafficPeriodHours;
    const bounded = (value: number, min: number, max: number) =>
      Number.isFinite(value) && value >= min && value <= max;
    if (
      !Number.isInteger(settings.maxActive) ||
      !Number.isInteger(settings.perHost) ||
      !Number.isInteger(settings.retentionDays) ||
      !bounded(settings.maxActive, 1, 8) ||
      !bounded(settings.perHost, 1, 16) ||
      ![1, 2, 4, 8, 16].includes(settings.maxConnections) ||
      !bounded(settings.globalLimit, 0, 1e12) ||
      !bounded(settings.retentionDays, 1, 3650) ||
      !Number.isSafeInteger(settings.trafficLimit) ||
      !bounded(settings.trafficLimit, 0, 1e15) ||
      !Number.isInteger(settings.trafficPeriodHours) ||
      !Number.isInteger(settings.retryAttempts) ||
      !bounded(settings.retryAttempts, 0, 20) ||
      !Number.isInteger(settings.retryDelaySeconds) ||
      !bounded(settings.retryDelaySeconds, 1, 86400) ||
      !bounded(settings.trafficPeriodHours, 1, 168) ||
      typeof settings.completionSound !== 'boolean' ||
      !['auto', 'manual'].includes(settings.mode) ||
      !['ask', 'auto'].includes(settings.recovery) ||
      !['dark', 'light', 'system'].includes(settings.theme)
    )
      throw new Error('Invalid settings.');
    if (
      !Array.isArray(settings.queues) ||
      settings.queues.length > 30 ||
      new Set(settings.queues.map((queue) => queue.id)).size !== settings.queues.length ||
      settings.queues.some(
        (queue) =>
          !queue.id ||
          queue.id === 'default' ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(queue.id) ||
          !queue.name?.trim() ||
          queue.name.length > 60 ||
          !Number.isInteger(queue.maxActive) ||
          !bounded(queue.maxActive, 1, 8) ||
          !bounded(queue.speedLimit, 0, 1e12) ||
          typeof queue.paused !== 'boolean' ||
          (queue.manualRun !== undefined && typeof queue.manualRun !== 'boolean') ||
          (queue.retryAttempts !== undefined &&
            (!Number.isInteger(queue.retryAttempts) || !bounded(queue.retryAttempts, 0, 20))) ||
          (queue.retryDelaySeconds !== undefined &&
            (!Number.isInteger(queue.retryDelaySeconds) ||
              !bounded(queue.retryDelaySeconds, 1, 86400))) ||
          (queue.repeatMinutes !== undefined &&
            (!Number.isInteger(queue.repeatMinutes) ||
              queue.repeatMinutes < 0 ||
              queue.repeatMinutes > 10080 ||
              (!!queue.repeatMinutes && queue.stopOnComplete))) ||
          (queue.nextRunAt != null &&
            (!Number.isSafeInteger(queue.nextRunAt) || queue.nextRunAt < 0)) ||
          (queue.days !== undefined &&
            (!Array.isArray(queue.days) ||
              queue.days.length > 7 ||
              new Set(queue.days).size !== queue.days.length ||
              queue.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) ||
          [queue.startsAt, queue.stopsAt].some(
            (at) => at != null && (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000),
          ) ||
          (queue.startsAt != null && queue.stopsAt != null && queue.stopsAt <= queue.startsAt) ||
          [queue.windowStart, queue.windowEnd].some(
            (time) => typeof time !== 'string' || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)),
          ),
      )
    )
      throw new Error('Invalid download queue settings.');
    if (
      [settings.windowStart, settings.windowEnd].some(
        (s) => s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s),
      )
    )
      throw new Error('Use valid daily window times.');
    const soundPreparation =
      settings.completionSound && !this.snapshot.settings.completionSound
        ? enableCompletionSound().then(
            () => '',
            (error) => safeError(error),
          )
        : Promise.resolve('');
    if (isExtension && settings.interception && !this.snapshot.settings.interception) {
      if (
        !(await chrome.permissions.request({
          origins: captureOrigins,
          permissions: settings.notifications ? ['notifications'] : [],
        }))
      )
        throw new Error('Enable website access to capture download clicks automatically.');
    }
    if (
      settings.notifications &&
      !this.snapshot.settings.notifications &&
      isExtension &&
      !(await chrome.permissions.request({ permissions: ['notifications'] }))
    )
      throw new Error('Notifications permission was declined.');
    const soundError = await soundPreparation;
    if (soundError) throw new Error(soundError);
    const priorHold = this.holdQueue;
    const interrupted = allowanceChanged ? [...this.active] : [];
    if (allowanceChanged) this.holdQueue = true;
    try {
      await Promise.all(interrupted.map((id) => this.stop(this.job(id))));
      await this.repository.putSettings(settings);
      this.publish({ settings });
      this.worker?.postMessage({ type: 'settings', settings });
      for (const job of this.snapshot.jobs)
        if (
          job.state === 'PAUSED' &&
          ((renewAllowance && job.budgetResumeAt) || interrupted.includes(job.id))
        ) {
          job.budgetResumeAt = null;
          transition(job, 'QUEUED', 'Download allowance updated');
          await this.persist(job);
        }
      if (isExtension) await chrome.runtime.sendMessage({ type: 'configure-offers' });
    } finally {
      this.holdQueue = priorHold;
    }
    await this.pump();
  }
  async enableAutomaticCapture() {
    this.ensureOwner();
    if (!isExtension) throw new Error('Automatic capture requires the installed Chrome extension.');
    if (!(await chrome.permissions.request({ origins: captureOrigins })))
      throw new Error('Website access was declined. Automatic capture remains off.');
    const settings = { ...this.snapshot.settings, interception: true };
    await this.repository.putSettings(settings);
    this.publish({ settings });
    const response = await chrome.runtime.sendMessage({ type: 'configure-offers' });
    if (response?.error) throw new Error(response.error);
  }
  private async refreshQueue() {
    if (!this.owned || !this.snapshot.ready) return;
    const stored = await this.repository.getJobs();
    const known = new Set(this.snapshot.jobs.map((job) => job.id));
    const added = stored.filter((job) => !known.has(job.id) && !job.capturePending);
    const jobs = this.snapshot.jobs.flatMap((job) => {
      if (job.engine === 'browser') return stored.filter((item) => item.id === job.id);
      if (!job.capturePending) return [job];
      const durable = stored.find((item) => item.id === job.id);
      return durable ? [durable.capturePending ? job : durable] : [];
    });
    if (
      added.length ||
      jobs.some((job, index) => job !== this.snapshot.jobs[index]) ||
      jobs.length !== this.snapshot.jobs.length
    )
      this.publish({ jobs: [...added, ...jobs] });
    await this.pump();
  }
  async updateJob(
    id: string,
    patch: Partial<
      Pick<
        DownloadJob,
        | 'filename'
        | 'priority'
        | 'scheduledAt'
        | 'speedLimit'
        | 'maxConnections'
        | 'mode'
        | 'queueId'
      >
    >,
  ) {
    this.ensureOwner();
    const job = this.job(id);
    if (job.engine === 'browser')
      throw new Error('The original browser transfer uses Chrome transfer settings.');
    if (
      job.media &&
      ((patch.maxConnections !== undefined && patch.maxConnections !== job.maxConnections) ||
        (patch.mode !== undefined && patch.mode !== job.mode))
    )
      throw new Error('This stream is assembled in playlist order with one active media request.');
    this.validateQueue(patch.queueId);
    if (this.active.has(id)) throw new Error('Pause this transfer before changing its options.');
    if (patch.filename !== undefined) {
      patch.filename = sanitizeFilename(patch.filename);
      job.category = categoryOf(patch.filename);
    }
    if (patch.maxConnections !== undefined && ![1, 2, 4, 8, 16].includes(patch.maxConnections))
      throw new Error('Invalid connection count.');
    if (
      patch.speedLimit !== undefined &&
      (!Number.isFinite(patch.speedLimit) || patch.speedLimit < 0)
    )
      throw new Error('Invalid speed limit.');
    if (
      patch.priority !== undefined &&
      (!Number.isFinite(patch.priority) || Math.abs(patch.priority) > 100)
    )
      throw new Error('Invalid priority.');
    Object.assign(job, patch);
    await this.persist(job);
    await this.pump();
  }
  async exportFile(id: string, saveAs = false) {
    this.ensureOwner();
    const job = this.job(id);
    if (job.engine === 'browser')
      throw new Error(
        'Chrome saves this original transfer directly. Use Show in folder after it finishes.',
      );
    if (!job.sha256 || !['ASSEMBLING', 'COMPLETED', 'FAILED'].includes(job.state))
      throw new Error('The file must finish verification before saving.');
    if (!saveAs) {
      // Save straight into the configured location (category folder), without a dialog.
      if (this.snapshot.settings.saveLocation === 'folder' && this.directory) {
        // Called before any other await so the click still counts as user activation.
        const granted = await (
          this.directory as FileSystemDirectoryHandle & {
            requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
          }
        ).requestPermission({ mode: 'readwrite' });
        if (granted !== 'granted') throw new Error('Folder access was declined.');
        await this.refreshDestination();
      }
      // Same as writeExport: verified data is already staged, so a finished job can be saved again.
      if (job.state !== 'ASSEMBLING') job.state = 'ASSEMBLING';
      try {
        await this.saveToDestination(id, job);
      } catch (error) {
        if (job.state === 'ASSEMBLING') {
          job.error = 'Save could not finish. Verified data is retained. ' + safeError(error);
          await this.persist(job);
        }
        throw error;
      }
      return;
    }
    // Invoke picker before awaiting anything to preserve transient user activation.
    const picker = (
      window as Window & {
        showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;
    if (!picker)
      throw new Error('Save As requires Chrome desktop with File System Access support.');
    const handle = await picker({ suggestedName: job.filename });
    await this.writeExport(id, handle, job);
  }
  private async writeExport(id: string, handle: FileSystemFileHandle, job: DownloadJob) {
    if (
      this.job(id) !== job ||
      !job.sha256 ||
      !['ASSEMBLING', 'COMPLETED', 'FAILED'].includes(job.state)
    )
      throw new Error('This download changed while the save dialog was open. Open Save again.');
    if (job.state === 'COMPLETED') job.state = 'ASSEMBLING';
    transition(job, 'EXPORTING');
    let writable: FileSystemWritableFileStream | null = null;
    let destinationCommitted = false;
    try {
      await this.persist(job);
      const file = await partialFile(id);
      if (file.size !== job.total) throw new Error('Stored file size changed. Export stopped.');
      const hasher = await createSHA256();
      hasher.init();
      const verify = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          hasher.update(chunk);
          controller.enqueue(chunk);
        },
        flush() {
          if (hasher.digest('hex') !== job.sha256)
            throw new Error(
              'Saved content failed SHA-256 verification. The destination was not committed.',
            );
        },
      });
      writable = await handle.createWritable();
      await file.stream().pipeThrough(verify).pipeTo(writable);
      writable = null;
      destinationCommitted = true;
      transition(job, 'COMPLETED');
      job.savedDownloadId = null;
      job.exported = true;
      job.exportedAt = Date.now();
      job.error = null;
      await this.persist(job);
    } catch (error) {
      if (writable) await writable.abort().catch(() => undefined);
      if (destinationCommitted) {
        job.error =
          'File saved successfully, but history could not be updated. ' + safeError(error);
        this.publish();
        throw new Error(job.error);
      }
      transition(job, 'ASSEMBLING', 'Save interrupted; verified data retained');
      job.error = safeError(error);
      await this.persist(job);
      throw error;
    }
  }
  private async refreshDestination() {
    const authorized = this.directory
      ? await (
          this.directory as FileSystemDirectoryHandle & {
            queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
          }
        )
          .queryPermission({ mode: 'readwrite' })
          .then((state) => state === 'granted')
          .catch(() => false)
      : false;
    this.publish({
      destination: this.directory ? { name: this.directory.name, authorized } : undefined,
    });
    return authorized;
  }
  async chooseDownloadFolder() {
    this.ensureOwner();
    const picker = (
      window as Window & {
        showDirectoryPicker?: (options: {
          mode: 'readwrite';
          id: string;
          startIn?: string;
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker)
      throw new Error(
        'This browser has no folder picker. In Brave, open brave://flags/#file-system-access-api, set it to Enabled, restart, and try again.',
      );
    const handle = await picker({ mode: 'readwrite', id: 'flux-downloads', startIn: 'downloads' });
    await this.repository.putDestination(handle);
    this.directory = handle;
    await this.refreshDestination();
    await this.updateSettings({
      ...this.snapshot.settings,
      autoSave: true,
      saveLocation: 'folder',
    });
    for (const job of this.snapshot.jobs)
      if (job.state === 'ASSEMBLING') this.scheduleAutoSave(job.id);
  }
  private scheduleAutoSave(id: string) {
    this.autoExports = this.autoExports
      .catch(() => undefined)
      .then(async () => {
        const job = this.snapshot.jobs.find((item) => item.id === id);
        const settings = this.snapshot.settings;
        if (!job || job.state !== 'ASSEMBLING' || !settings.autoSave) return;
        if (settings.saveLocation === 'folder') {
          if (!this.directory) return;
          if (!(await this.refreshDestination())) {
            if (!this.snapshot.jobs.includes(job)) return;
            job.note =
              'Choose the download folder again to restore saving permission. Verified data is retained.';
            await this.persist(job);
            return;
          }
        } else if (!isExtension) return;
        try {
          await this.saveToDestination(id, job);
        } catch (error) {
          if (this.snapshot.jobs.includes(job) && job.state === 'ASSEMBLING') {
            job.error =
              'Automatic save could not finish. Verified data is retained. ' + safeError(error);
            await this.persist(job);
          }
        }
      })
      .catch((error) =>
        this.publish({ error: 'Automatic save needs attention. ' + safeError(error) }),
      );
  }
  /** Saves a verified file to the configured location (Downloads or chosen folder), no dialog. */
  private async saveToDestination(id: string, job: DownloadJob) {
    const settings = this.snapshot.settings;
    if (settings.saveLocation !== 'folder') {
      await this.saveToDownloads(id, job, downloadsRelativePath(job.filename, settings));
      return;
    }
    if (!this.directory) throw new Error('Choose a download folder in Settings first.');
    let directory = this.directory;
    if (settings.saveByCategory)
      for (const part of categoryFolderName(job.category, settings).split('/'))
        directory = await directory.getDirectoryHandle(part, { create: true });
    const dot = job.filename.lastIndexOf('.');
    const stem = dot > 0 ? job.filename.slice(0, dot) : job.filename;
    const extension = dot > 0 ? job.filename.slice(dot) : '';
    let filename = job.filename;
    for (let collision = 0; collision < 10000; collision++) {
      try {
        await directory.getFileHandle(filename);
        filename = `${stem.slice(0, 150)} (${collision + 1})${extension}`;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') break;
        throw error;
      }
      if (collision === 9999) throw new Error('Too many files share this filename. Use Save As.');
    }
    if (!this.snapshot.jobs.includes(job) || job.state !== 'ASSEMBLING') return;
    const handle = await directory.getFileHandle(filename, { create: true });
    await this.writeExport(id, handle, job);
  }
  private async setSaveDialogDetected(value: boolean) {
    if (!!this.snapshot.settings.saveDialogDetected === value) return;
    const settings = { ...(await this.repository.getSettings()), saveDialogDetected: value };
    await this.repository.putSettings(settings);
    this.publish({ settings });
  }
  /** Turns automatic saving on or off from the main page. */
  async setAutoSave(enabled: boolean) {
    this.ensureOwner();
    await this.updateSettings({ ...this.snapshot.settings, autoSave: enabled });
    if (enabled)
      for (const job of this.snapshot.jobs)
        if (job.state === 'ASSEMBLING') this.scheduleAutoSave(job.id);
  }
  /** Hands the verified staged file to Chrome, which writes it under its Downloads folder. */
  private async saveToDownloads(id: string, job: DownloadJob, relativePath: string) {
    if (!job.sha256 || job.state !== 'ASSEMBLING') return;
    const file = await partialFile(id);
    if (file.size !== job.total) throw new Error('Stored file size changed. Save stopped.');
    if (this.job(id) !== job || job.state !== 'ASSEMBLING') return;
    transition(job, 'EXPORTING');
    let url: string | null = null;
    let destinationCommitted = false;
    try {
      await this.persist(job);
      // This path gives Chrome a file-backed Blob instead of a writable stream.
      // Recheck that exact immutable File snapshot before Chrome can commit it.
      const hasher = await createSHA256();
      hasher.init();
      const reader = file.stream().getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          hasher.update(part.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (hasher.digest('hex') !== job.sha256)
        throw new Error('Stored content failed SHA-256 verification. No browser save was started.');
      // An untyped blob lets Chrome swap the extension (e.g. .bin -> .txt); octet-stream keeps it.
      url = URL.createObjectURL(new Blob([file], { type: 'application/octet-stream' }));
      // Read by the background onDeterminingFilename listener, which otherwise renames the file.
      await chrome.storage.session.set({ [`save:${url}`]: relativePath });
      const downloadId = await chrome.downloads.download({
        url,
        filename: relativePath,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      // Browsers set to "ask where to save" hold the save in a dialog with no target filename.
      let dialogSeen = false;
      const dialogProbe = setTimeout(() => {
        void chrome.downloads.search({ id: downloadId }).then(([current]) => {
          if (current?.state === 'in_progress' && !current.filename) {
            dialogSeen = true;
            void this.setSaveDialogDetected(true);
          }
        });
      }, 1500);
      const item = await new Promise<chrome.downloads.DownloadItem>((resolve, reject) => {
        const check = async () => {
          const current = (await chrome.downloads.search({ id: downloadId }))[0];
          if (!current) return finish(new Error('Chrome removed the save before it finished.'));
          if (current.state === 'complete') finish(undefined, current);
          else if (current.state === 'interrupted') {
            if (current.error === 'USER_CANCELED') void this.setSaveDialogDetected(true);
            finish(
              new Error(`Chrome could not write the file (${current.error ?? 'interrupted'}).`),
            );
          }
        };
        const listener = (change: chrome.downloads.DownloadDelta) => {
          if (change.id === downloadId && change.state) void check().catch(finish);
        };
        const finish = (error?: unknown, value?: chrome.downloads.DownloadItem) => {
          clearTimeout(dialogProbe);
          chrome.downloads.onChanged.removeListener(listener);
          if (value) resolve(value);
          else reject(error);
        };
        chrome.downloads.onChanged.addListener(listener);
        void check().catch(finish);
      });
      destinationCommitted = true;
      if (!dialogSeen && this.snapshot.settings.saveDialogDetected)
        await this.setSaveDialogDetected(false);
      job.savedDownloadId = item.id;
      transition(job, 'COMPLETED');
      job.exported = true;
      job.exportedAt = Date.now();
      job.error = null;
      const folder = relativePath.split('/').slice(0, -1).join('/');
      job.note = folder ? `Saved to Downloads/${folder}` : 'Saved to your Downloads folder';
      await this.persist(job);
    } catch (error) {
      if (destinationCommitted) {
        job.error =
          'File saved successfully, but history could not be updated. ' + safeError(error);
        this.publish();
        throw new Error(job.error);
      }
      transition(job, 'ASSEMBLING', 'Save interrupted; verified data retained');
      throw error;
    } finally {
      if (url) {
        URL.revokeObjectURL(url);
        await chrome.storage.session.remove(`save:${url}`).catch(() => undefined);
      }
    }
  }
  async browserDownload(id: string) {
    const job = this.job(id);
    if (job.pageFile) throw new Error('Create this file again on its website.');
    if (job.media)
      throw new Error(
        'A browser transfer would save only the playlist. Use Flux stream assembly for this video.',
      );
    if (job.engine === 'browser') {
      await this.action(id, 'review-browser');
      return;
    }
    if (
      job.expectedHash &&
      !window.confirm(
        'The original browser transfer cannot verify the expected SHA-256 in Flux. Continue with browser transfer?',
      )
    )
      return;
    if (job.sha256 || ['ASSEMBLING', 'COMPLETED', 'EXPORTING'].includes(job.state))
      throw new Error('This file is already verified. Use Save to export it.');
    await this.action(id, 'pause');
    if (!isExtension) throw new Error('Browser download is available in the installed extension.');
    const nativeId = await chrome.downloads.download({
      url: job.url,
      filename: job.filename,
      saveAs: true,
      conflictAction: 'uniquify',
    });
    const result = await chrome.runtime.sendMessage({
      type: 'register-native',
      id: nativeId,
      replaces: id,
    });
    if (result?.error)
      throw new Error(
        'Chrome started the transfer, but Flux could not link its history. Review Chrome downloads. ' +
          result.error,
      );
    this.applyBrowserUpdate(result?.job);
    await removePartial(id).catch((error) =>
      this.publish({
        error:
          'Browser transfer started. Temporary data cleanup needs attention. ' + safeError(error),
      }),
    );
  }
  async clearHistory() {
    for (const job of [...this.snapshot.jobs])
      if (['COMPLETED', 'CANCELED'].includes(job.state)) await this.action(job.id, 'remove');
  }
  async cleanup() {
    this.ensureOwner();
    await this.pageTransfers.whenIdle(async () => {
      await cleanupOrphans(new Set(this.snapshot.jobs.map((j) => j.id)));
      const cutoff = Date.now() - this.snapshot.settings.retentionDays * 86400000;
      for (const job of [...this.snapshot.jobs])
        if (job.exported && job.updatedAt < cutoff) await this.action(job.id, 'remove');
      await this.refreshStorage();
    });
  }
  async requestPersistence() {
    return navigator.storage.persist();
  }
  async previewCompletionSound() {
    await enableCompletionSound();
    playCompletionSound();
  }
  async detectMedia() {
    if (!isExtension) return [];
    const result = await chrome.runtime.sendMessage({ type: 'detect-media' });
    if (result?.error) throw new Error(result.error);
    return result?.items ?? [];
  }
  async discoverLinks() {
    if (!isExtension) return [];
    const result = await chrome.runtime.sendMessage({ type: 'discover-links' });
    if (result?.error) throw new Error(result.error);
    return result?.items ?? [];
  }
  private async pump() {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    if (!this.owned || !this.snapshot.ready || this.holdQueue || !this.worker) return;
    this.pumping = true;
    try {
      if (this.scheduled) clearTimeout(this.scheduled);
      this.scheduled = null;
      for (const job of this.snapshot.jobs) {
        const at = nextRetryAt(job, this.snapshot.settings);
        if ((job.queueRetryAt ?? null) !== at) {
          job.queueRetryAt = at;
          if (at != null) {
            const count = (job.queueRetries ?? 0) + 1;
            job.timeline = [
              ...job.timeline.slice(-99),
              {
                at: Date.now(),
                event: `Automatic retry ${count} scheduled for ${new Date(at).toLocaleString()}`,
              },
            ];
          }
          await this.persist(job);
        }
      }
      for (const job of this.snapshot.jobs)
        if (
          job.budgetResumeAt &&
          (!this.snapshot.settings.trafficLimit || job.budgetResumeAt <= Date.now()) &&
          job.state === 'PAUSED'
        ) {
          job.budgetResumeAt = null;
          transition(job, 'QUEUED', 'Download allowance renewed');
          await this.persist(job);
        }
      for (const id of this.forced) {
        const job = this.snapshot.jobs.find((item) => item.id === id);
        if (!job || (!this.active.has(id) && job.state !== 'QUEUED')) this.forced.delete(id);
      }
      const windowOpen = inTimeWindow(this.snapshot.settings);
      if (!windowOpen) {
        const active = [...this.active].filter((id) => !this.forced.has(id));
        await Promise.all(active.map((id) => this.stop(this.job(id))));
        for (const id of active) {
          const job = this.snapshot.jobs.find((j) => j.id === id);
          if (job?.state === 'PAUSED') {
            transition(job, 'QUEUED', 'Waiting for the next download window');
            await this.persist(job);
          }
        }
        const next = nextWindowBoundary(this.snapshot.settings);
        if (
          next &&
          (this.snapshot.jobs.some(
            (j) => j.state === 'QUEUED' || !!j.budgetResumeAt || j.queueRetryAt != null,
          ) ||
            this.snapshot.settings.queues.some(
              (queue) => !queue.paused && queue.repeatMinutes && queue.nextRunAt,
            ))
        ) {
          this.scheduled = setTimeout(() => void this.pump(), Math.max(0, next - Date.now()));
          if (isExtension) await chrome.alarms.create('flux-queue', { when: next });
        }
        if (!this.forced.size) return;
        if (this.scheduled) clearTimeout(this.scheduled);
        this.scheduled = null;
      }
      await this.latchQueueRuns();
      for (const id of [...this.active]) {
        if (this.forced.has(id)) continue;
        const job = this.job(id);
        const queue = this.snapshot.settings.queues.find((item) => item.id === job.queueId);
        if (queue && !queueAvailable(queue)) {
          await this.stop(job);
          const stopped = this.job(id);
          if (stopped.state === 'PAUSED') {
            transition(
              stopped,
              'QUEUED',
              queue.paused
                ? 'Waiting for this queue to start'
                : 'Waiting for the queue download window',
            );
            await this.persist(stopped);
          }
        }
      }
      await this.repeatQueues();
      for (const job of orderedQueue(this.snapshot.jobs)) {
        if (job.engine === 'browser' || job.pageFile) continue;
        if (this.holdQueue) break;
        if (
          this.snapshot.jobs.find((j) => j.id === job.id) !== job ||
          (job.state !== 'QUEUED' && !retryDue(job))
        )
          continue;
        if (this.active.size >= this.snapshot.settings.maxActive) break;
        const forced = this.forced.has(job.id);
        if (!windowOpen && !forced) continue;
        const queue = this.snapshot.settings.queues.find((item) => item.id === job.queueId);
        if (
          queue &&
          !forced &&
          (!queueAvailable(queue) ||
            [...this.active].filter((id) => this.job(id).queueId === queue.id).length >=
              queue.maxActive)
        )
          continue;
        if (
          isExtension &&
          !(await chrome.permissions.contains({ origins: [originPattern(job.url)] }))
        ) {
          if (job.state !== 'FAILED')
            transition(job, 'PAUSED', 'Website access was revoked. Restore access in Chrome.');
          job.queueRetryAt = null;
          job.retryFailure = null;
          job.error = 'Website access is required.';
          job.permissionOrigin = new URL(job.url).origin;
          await this.persist(job);
          continue;
        }
        if (
          this.holdQueue ||
          this.snapshot.jobs.find((j) => j.id === job.id) !== job ||
          (job.state !== 'QUEUED' && !retryDue(job))
        )
          continue;
        if (retryDue(job)) {
          job.queueRetries = (job.queueRetries ?? 0) + 1;
          job.queueRetryAt = null;
          job.retryFailure = null;
          transition(job, 'QUEUED', `Starting automatic retry ${job.queueRetries}`);
        }
        transition(job, 'PROBING');
        job.error = null;
        const starting = Promise.resolve().then(async () => {
          try {
            await this.persist(job);
            this.active.add(job.id);
            if (queue) this.armedQueues.add(queue.id);
            this.worker!.postMessage({
              type: 'start',
              job: structuredClone(job),
              settings: this.snapshot.settings,
            });
          } catch (error) {
            this.active.delete(job.id);
            job.state = 'FAILED';
            job.error = safeError(error);
            job.retryFailure = null;
            job.queueRetryAt = null;
            this.publish();
            throw error;
          }
        });
        this.starting.set(job.id, starting);
        try {
          await starting;
        } finally {
          this.starting.delete(job.id);
        }
      }
      await this.completeQueues();
      const future = this.snapshot.jobs
        .filter(
          (j) =>
            (j.state === 'QUEUED' || j.queueRetryAt != null) &&
            j.scheduledAt &&
            j.scheduledAt > Date.now(),
        )
        .map((j) => j.scheduledAt!);
      future.push(
        ...this.snapshot.jobs
          .filter(
            (job) =>
              job.state === 'FAILED' && job.queueRetryAt != null && job.queueRetryAt > Date.now(),
          )
          .map((job) => job.queueRetryAt!),
        ...this.snapshot.jobs
          .filter(
            (job) =>
              job.state === 'PAUSED' && job.budgetResumeAt && job.budgetResumeAt > Date.now(),
          )
          .map((job) => job.budgetResumeAt!),
      );
      const boundary = nextWindowBoundary(this.snapshot.settings);
      if (
        boundary &&
        (this.active.size ||
          this.snapshot.jobs.some((j) => j.state === 'QUEUED' || j.queueRetryAt != null))
      )
        future.push(boundary);
      for (const queue of this.snapshot.settings.queues) {
        if (!queue.paused && queue.nextRunAt && queue.nextRunAt > Date.now())
          future.push(queue.nextRunAt);
        if (
          queue.paused ||
          (!queue.repeatMinutes &&
            !this.snapshot.jobs.some(
              (job) =>
                job.queueId === queue.id &&
                (job.state === 'QUEUED' || job.queueRetryAt != null || this.active.has(job.id)),
            ))
        )
          continue;
        const next = nextQueueBoundary(queue);
        if (next) future.push(next);
      }
      if (future.length) {
        const when = Math.min(...future);
        this.scheduled = setTimeout(
          () => void this.pump(),
          Math.min(2147483647, Math.max(0, when - Date.now())),
        );
        if (isExtension) await chrome.alarms.create('flux-queue', { when });
      }
    } catch (error) {
      this.publish({ error: safeError(error) });
    } finally {
      this.pumping = false;
      if (this.pumpAgain) {
        this.pumpAgain = false;
        queueMicrotask(() => void this.pump());
      }
    }
  }
  /** A queue with only a start time keeps running past midnight until its files finish. */
  private async latchQueueRuns() {
    const due = new Set(
      this.snapshot.settings.queues
        .filter(
          (queue) =>
            !queue.paused &&
            !queue.manualRun &&
            queue.windowStart &&
            !queue.windowEnd &&
            queueAvailable(queue) &&
            this.snapshot.jobs.some((job) => job.queueId === queue.id && job.state === 'QUEUED'),
        )
        .map((queue) => queue.id),
    );
    if (!due.size) return;
    const settings = {
      ...this.snapshot.settings,
      queues: this.snapshot.settings.queues.map((queue) =>
        due.has(queue.id) ? { ...queue, manualRun: true } : queue,
      ),
    };
    await this.repository.putSettings(settings);
    this.publish({ settings });
  }
  private async completeQueues() {
    for (const queue of this.snapshot.settings.queues) {
      const id = queue.id;
      const jobs = this.snapshot.jobs.filter((job) => job.queueId === id);
      if (
        !jobs.length ||
        jobs.some((job) => !['ASSEMBLING', 'COMPLETED', 'CANCELED'].includes(job.state)) ||
        !jobs.some((job) => job.state !== 'CANCELED')
      )
        continue;
      const notify = this.armedQueues.delete(id);
      if (queue.manualRun) {
        const settings = {
          ...this.snapshot.settings,
          queues: this.snapshot.settings.queues.map((item) =>
            item.id === id ? { ...item, manualRun: false } : item,
          ),
        };
        await this.repository.putSettings(settings);
        this.publish({ settings });
      }
      if (notify && queue.notifyOnComplete && this.snapshot.settings.notifications && isExtension)
        await chrome.notifications
          .create({
            type: 'basic',
            iconUrl: 'icon128.png',
            title: 'Flux — queue verified',
            message: `${queue.name}: all files verified. ${jobs.filter((job) => job.state === 'ASSEMBLING').length} waiting to save.`,
          })
          .catch((error) => this.publish({ error: safeError(error) }));
      if (queue.stopOnComplete && !queue.paused) {
        const settings = {
          ...this.snapshot.settings,
          queues: this.snapshot.settings.queues.map((item) =>
            item.id === id ? { ...item, paused: true } : item,
          ),
        };
        await this.repository.putSettings(settings);
        this.publish({ settings });
      }
      if (queue.repeatMinutes && !queue.paused && !queue.nextRunAt) {
        const settings = {
          ...this.snapshot.settings,
          queues: this.snapshot.settings.queues.map((item) =>
            item.id === id
              ? { ...item, nextRunAt: Date.now() + queue.repeatMinutes! * 60000 }
              : item,
          ),
        };
        await this.repository.putSettings(settings);
        this.publish({ settings });
      }
    }
  }
  private async repeatQueues() {
    for (const queue of this.snapshot.settings.queues) {
      if (
        !queue.repeatMinutes ||
        !queue.nextRunAt ||
        queue.nextRunAt > Date.now() ||
        !queueAvailable(queue)
      )
        continue;
      const jobs = this.snapshot.jobs.filter((job) => job.queueId === queue.id);
      if (jobs.some((job) => !['ASSEMBLING', 'COMPLETED', 'CANCELED'].includes(job.state)))
        continue;
      const templates = [
        ...new Map(
          jobs
            .filter((job) => job.engine !== 'browser' && !job.pageFile)
            .filter((job) => job.state !== 'CANCELED')
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((job) => [downloadIdentity(job.url, job.media?.audioUrl), job]),
        ).values(),
      ];
      if (!templates.length) continue;
      if (templates.length > 500)
        throw new Error(
          'Periodic queues support up to 500 unique file addresses. Split this queue before repeating.',
        );
      const next = templates.map((template) => ({
        ...createJob(
          {
            url: template.url,
            useBrowserCookies: template.useBrowserCookies,
            filename: template.filename,
            priority: template.priority,
            speedLimit: template.speedLimit,
            expectedHash: template.expectedHash ?? undefined,
            media: template.media?.kind,
            audioUrl: template.media?.audioUrl,
            audioLabel: template.media?.audioLabel,
            queueId: queue.id,
          },
          this.snapshot.settings,
        ),
        maxConnections: template.maxConnections,
        mode: template.mode,
      }));
      const settings = {
        ...this.snapshot.settings,
        queues: this.snapshot.settings.queues.map((item) =>
          item.id === queue.id ? { ...item, nextRunAt: null } : item,
        ),
      };
      await this.repository.putQueueRun(next, settings);
      this.publish({ jobs: [...next, ...this.snapshot.jobs], settings });
    }
  }
}
export const manager: ManagerAPI = new Manager();
