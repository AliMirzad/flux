import { runDownload } from './runner';
import { OPFSStore } from '../storage/opfs';
import { Repository } from '../storage/repository';
import { BandwidthLimiter, HostSlots } from './speed/control';
import type { WorkerCommand, WorkerEvent } from '../messaging/protocol';
import { completeBytes } from './segmentation/ranges';
import { safeError } from '../shared/security';
import { transition, canTransition } from '../domain/state';
import { HostPermissionError } from './network/policy';
import { abortError } from './speed/control';
import { TrafficBudget, TrafficLimitError } from './speed/budget';
import { HttpError, retryable } from './network/http';
import { runHlsDownload } from './media/runner';
import { reviewHls } from './media/network';
const repository = new Repository();
const controllers = new Map<string, AbortController>();
const inspections = new Map<string, AbortController>();
const hostSlots = new HostSlots();
const bandwidth = new BandwidthLimiter();
const queueBandwidth = new Map<string, BandwidthLimiter>();
const send = (event: WorkerEvent) => postMessage(event);
const budget = new TrafficBudget(
  { load: () => repository.getTraffic(), save: (record) => repository.putTraffic(record) },
  (state) => send({ type: 'traffic', ...state }),
);
let budgetReady: Promise<void> = Promise.resolve();
const redirectReplies = new Map<
  string,
  (message: Extract<WorkerCommand, { type: 'redirect-result' }>) => void
>();
function networkDecision(
  type: 'redirect' | 'prepare-request',
  from: string,
  location: string | null,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      redirectReplies.delete(requestId);
    };
    const abort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new DOMException('Redirect lookup timed out. Retry this download.', 'TimeoutError'));
    }, 5000);
    redirectReplies.set(requestId, (message) => {
      cleanup();
      if (message.permissionOrigin) reject(new HostPermissionError(message.permissionOrigin));
      else if (message.url) resolve(message.url);
      else reject(new Error(message.error ?? 'Could not resolve the redirect.'));
    });
    signal.addEventListener('abort', abort, { once: true });
    send({ type, requestId, from, location });
  });
}
self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const message = event.data;
  if (message.type === 'cancel-hls-review') {
    inspections.get(message.requestId)?.abort();
    return;
  }
  if (message.type === 'inspect-hls') {
    const controller = new AbortController();
    inspections.set(message.requestId, controller);
    void reviewHls(
      message.url,
      {
        signal: controller.signal,
        acquireHost: (host, signal) => hostSlots.acquire(host, signal),
        redirectPolicy: {
          credentialOrigin: message.useBrowserCookies ? new URL(message.url).origin : undefined,
          resolveRedirect: (from, location, signal) =>
            networkDecision('redirect', from, location, signal),
          prepareRequest: async (url, signal) => {
            await networkDecision('prepare-request', url, null, signal);
          },
        },
      },
      message.audioUrl,
    )
      .then(
        (review) => send({ type: 'hls-review', requestId: message.requestId, review }),
        (error) =>
          send({
            type: 'hls-review',
            requestId: message.requestId,
            error: safeError(error),
            ...(error instanceof HostPermissionError ? { permissionOrigin: error.origin } : {}),
          }),
      )
      .finally(() => inspections.delete(message.requestId));
    return;
  }
  if (message.type === 'redirect-result') {
    redirectReplies.get(message.requestId)?.(message);
    return;
  }
  if (message.type === 'pause') {
    controllers.get(message.id)?.abort();
    return;
  }
  hostSlots.limit = message.settings.perHost;
  bandwidth.rate = message.settings.globalLimit;
  budgetReady = budget.configure(
    message.settings.trafficLimit ?? 0,
    (message.settings.trafficPeriodHours ?? 24) * 3600000,
  );
  void budgetReady.catch(() => undefined);
  for (const id of queueBandwidth.keys())
    if (!message.settings.queues?.some((queue) => queue.id === id)) queueBandwidth.delete(id);
  for (const queue of message.settings.queues ?? []) {
    if (!queueBandwidth.has(queue.id)) queueBandwidth.set(queue.id, new BandwidthLimiter());
    queueBandwidth.get(queue.id)!.rate = queue.speedLimit;
  }
  if (message.type !== 'start' || controllers.has(message.job.id)) return;
  const { job, settings } = message;
  job.queueRetryAt = null;
  job.retryFailure = null;
  const controller = new AbortController();
  controllers.set(job.id, controller);
  void (async () => {
    try {
      await (job.media?.kind === 'hls' ? runHlsDownload : runDownload)({
        job,
        settings,
        store: new OPFSStore(),
        signal: controller.signal,
        checkpoint: (j) => repository.putJob(j),
        progress: (j) => send({ type: 'progress', job: j }),
        mediaCheckpoints: {
          load: () => repository.getMediaCheckpoints(job.id),
          save: (job, record) => repository.putMediaCheckpoint(job, record),
          clear: () => repository.clearMediaCheckpoints(job.id),
        },
        acquireHost: (host, signal) => hostSlots.acquire(host, signal),
        globalThrottle: async (bytes, signal) => {
          await bandwidth.consume(bytes, signal);
          await queueBandwidth.get(job.queueId ?? 'default')?.consume(bytes, signal);
        },
        checkAllowance: async (signal) => {
          await budgetReady;
          await budget.check(signal);
        },
        reservePayload: async (bytes, signal) => {
          await budgetReady;
          await budget.consume(bytes, signal);
        },
        accountPayload: async (bytes, signal) => {
          await budgetReady;
          await budget.consume(bytes, signal);
        },
        redirectPolicy: {
          credentialOrigin: job.useBrowserCookies ? new URL(job.url).origin : undefined,
          resolveRedirect: (from, location, signal) =>
            networkDecision('redirect', from, location, signal),
          prepareRequest: async (url, signal) => {
            await networkDecision('prepare-request', url, null, signal);
          },
        },
      });
      budget.report();
      send({ type: 'done', job });
    } catch (error) {
      const budgetWait = error instanceof TrafficLimitError && !controller.signal.aborted;
      job.downloaded = completeBytes(job.segments);
      job.connections = 0;
      job.speed = 0;
      job.connectionSpeeds = [];
      if (controller.signal.aborted || budgetWait) {
        if (job.state === 'DOWNLOADING' || job.state === 'PROBING' || job.state === 'RETRYING')
          transition(job, 'PAUSING');
        if (job.state === 'PAUSING') transition(job, 'PAUSED');
        if (budgetWait) {
          job.budgetResumeAt = error.resetsAt;
          job.error = null;
          job.note = `Download allowance reached. Resumes ${new Date(error.resetsAt).toLocaleString()}.`;
        }
      } else {
        job.permissionOrigin = error instanceof HostPermissionError ? error.origin : null;
        const at = Date.now();
        const delay = error instanceof HttpError ? error.retryAfter : 0;
        job.retryFailure =
          retryable(error) &&
          Number.isFinite(delay) &&
          delay >= 0 &&
          Number.isSafeInteger(Math.ceil(at + delay))
            ? { at, notBefore: Math.ceil(at + delay) }
            : null;
        job.error = safeError(error);
        transition(
          job,
          typeof navigator !== 'undefined' &&
            !navigator.onLine &&
            canTransition(job.state, 'WAITING_FOR_NETWORK')
            ? 'WAITING_FOR_NETWORK'
            : 'FAILED',
          job.error,
        );
      }
      try {
        await repository.putJob(job);
      } catch (storageError) {
        job.retryFailure = null;
        job.queueRetryAt = null;
        job.error = `${job.error ?? 'Paused'}. Metadata persistence failed: ${safeError(storageError)}`;
      }
      send({ type: controller.signal.aborted || budgetWait ? 'paused' : 'failed', job });
    } finally {
      controllers.delete(job.id);
    }
  })();
};
