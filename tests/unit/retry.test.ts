import { describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  numberHeader,
  retryAfterMs,
  retryDelay,
  retryable,
  request,
} from '../../src/engine/network/http';
import { defaultSettings } from '../../src/domain/model';
import { createJob } from '../../src/application/jobs';
import { nextRetryAt, retryDue, retryPolicy } from '../../src/domain/retry';
import { orderedQueue } from '../../src/application/queue';

describe('automatic whole-transfer retry policy', () => {
  const settings = { ...defaultSettings, retryAttempts: 3, retryDelaySeconds: 60 };
  const failed = () => ({
    ...createJob({ url: 'https://example.org/file' }),
    state: 'FAILED' as const,
    retryFailure: { at: 1000000, notBefore: 1000000 },
  });
  it('is off by default, doubles bounded delays and respects longer server not-before times', () => {
    const job = failed();
    expect(nextRetryAt(job, defaultSettings)).toBeNull();
    expect(nextRetryAt(job, settings)).toBe(1060000);
    expect(nextRetryAt({ ...job, queueRetries: 1 }, settings)).toBe(1120000);
    expect(nextRetryAt({ ...job, queueRetries: 2 }, settings)).toBe(1240000);
    expect(nextRetryAt({ ...job, queueRetries: 3 }, settings)).toBeNull();
    expect(
      nextRetryAt({ ...job, retryFailure: { at: 1000000, notBefore: 2000000 } }, settings),
    ).toBe(2000000);
    expect(
      nextRetryAt(
        { ...job, queueRetries: 19 },
        { ...settings, retryAttempts: 20, retryDelaySeconds: 86400 },
      ),
    ).toBe(87400000);
  });
  it('refuses native, manual, verified, permission and unsafe metadata failures', () => {
    const job = failed();
    for (const patch of [
      { engine: 'browser' as const },
      { state: 'PAUSED' as const },
      { sha256: 'a'.repeat(64) },
      { permissionOrigin: 'https://example.org' },
      { capturePending: true },
      { retryFailure: null },
      { retryFailure: { at: NaN, notBefore: 0 } },
      { queueRetries: -1 },
      { queueRetries: Infinity },
    ])
      expect(nextRetryAt({ ...job, ...patch }, settings)).toBeNull();
    expect(retryable(new Error('Final SHA-256 does not match'))).toBe(false);
    expect(retryable(new Error('Private address blocked'))).toBe(false);
  });
  it('inherits global settings while allowing an explicit disabled queue override', () => {
    const queue = {
      id: 'q',
      name: 'Queue',
      maxActive: 1,
      paused: false,
      speedLimit: 0,
      windowStart: '',
      windowEnd: '',
    };
    expect(retryPolicy(settings, queue)).toEqual({ attempts: 3, seconds: 60 });
    expect(
      nextRetryAt(
        { ...failed(), queueId: 'q' },
        { ...settings, queues: [{ ...queue, retryAttempts: 0 }] },
      ),
    ).toBeNull();
    expect(
      nextRetryAt(
        { ...failed(), queueId: 'q' },
        { ...settings, queues: [{ ...queue, retryAttempts: 1, retryDelaySeconds: 10 }] },
      ),
    ).toBe(1010000);
  });
  it('joins the priority-ordered runnable queue only after its due time and file schedule', () => {
    const retry = { ...failed(), queueRetryAt: 1060000, priority: 10 };
    const queued = createJob({ url: 'https://example.org/next' });
    expect(retryDue(retry, 1059999)).toBe(false);
    expect(orderedQueue([queued, retry], 1060000).map((job) => job.id)).toEqual([
      retry.id,
      queued.id,
    ]);
    expect(orderedQueue([{ ...retry, scheduledAt: 1070000 }], 1060000)).toEqual([]);
    expect(retryDue({ ...retry, retryFailure: null }, 1060000)).toBe(false);
  });
});

describe('bounded retries', () => {
  it('prepares the redirect observer before each hop and does not fetch a denied origin', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(`fetch:${String(url)}`);
      return String(url).endsWith('/first')
        ? new Response(null, { status: 302, headers: { Location: '/final' } })
        : new Response('ok');
    }) as unknown as typeof fetch;
    const policy = {
      prepareRequest: async (url: string) => {
        calls.push(`prepare:${url}`);
      },
      resolveRedirect: async (from: string, location: string | null) =>
        new URL(location!, from).href,
    };
    await request('https://example.org/first', {}, fetcher, false, policy);
    expect(calls).toEqual([
      'prepare:https://example.org/first',
      'fetch:https://example.org/first',
      'prepare:https://example.org/final',
      'fetch:https://example.org/final',
    ]);
    const denied = vi.fn();
    await expect(
      request('https://example.org/first', {}, denied, false, {
        ...policy,
        prepareRequest: async () => {
          throw new Error('Host access denied');
        },
      }),
    ).rejects.toThrow('Host access denied');
    expect(denied).not.toHaveBeenCalled();
  });
  it('respects Retry-After seconds and dates', () => {
    expect(retryAfterMs('3', 0)).toBe(3000);
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 1000)).toBe(4000);
    expect(retryAfterMs('invalid', 0)).toBe(0);
    expect(retryAfterMs('-10', 0)).toBe(0);
    expect(retryDelay(0)).toBe(500);
    expect(retryDelay(20)).toBe(30000);
    expect(retryDelay(2, 60000)).toBe(60000);
  });
  it('retries transient transport/status failures and refuses access failures', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504])
      expect(retryable(new HttpError(status, 0))).toBe(true);
    for (const status of [400, 401, 403, 404, 416])
      expect(retryable(new HttpError(status, 0))).toBe(false);
    expect(retryable(new TypeError('connection reset'))).toBe(true);
    expect(retryable(new DOMException('Redirect lookup timed out', 'TimeoutError'))).toBe(true);
    expect(retryable(new DOMException('storage full', 'QuotaExceededError'))).toBe(false);
    expect(retryable(new DOMException('paused', 'AbortError'))).toBe(false);
  });
  it('rejects invalid or unrepresentable file lengths', () => {
    expect(numberHeader('0')).toBe(0);
    expect(numberHeader('1024')).toBe(1024);
    for (const value of [null, 'bogus', '-1', '1.5', '9007199254740992'])
      expect(numberHeader(value)).toBeNull();
  });
});
