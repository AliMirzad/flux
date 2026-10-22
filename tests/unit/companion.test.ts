import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDiagnostics, probeCompanion } from '../../src/application/companion';

const diagnostics = () => ({
  companionVersion: '0.1.0',
  protocol: 1,
  platform: 'darwin',
  capabilities: ['diagnostics'],
  dependencies: {
    ytDlp: { available: false, status: 'missing' },
    ffmpeg: { available: true, status: 'available', version: '8.0' },
    ffprobe: { available: false, status: 'probe-failed' },
  },
});

function fakeRuntime() {
  const messages = new Set<(value: unknown) => void>();
  const disconnects = new Set<() => void>();
  const port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (fn: (value: unknown) => void) => messages.add(fn),
      removeListener: (fn: (value: unknown) => void) => messages.delete(fn),
    },
    onDisconnect: {
      addListener: (fn: () => void) => disconnects.add(fn),
      removeListener: (fn: () => void) => disconnects.delete(fn),
    },
  };
  const runtime = {
    connectNative: vi.fn(() => port),
    getManifest: () => ({ version: '0.7.0' }),
    lastError: undefined,
  };
  return {
    port,
    runtime: runtime as unknown as Parameters<typeof probeCompanion>[0],
    messages,
    disconnects,
    reply: (patch = {}) => {
      const request = port.postMessage.mock.calls[0]![0];
      for (const fn of [...messages])
        fn({ protocol: 1, kind: 'response', id: request.id, result: diagnostics(), ...patch });
    },
  };
}

afterEach(() => vi.useRealTimers());
describe('companion diagnostics boundary', () => {
  it('negotiates hello, validates diagnostics, and releases its port and listeners', async () => {
    const fake = fakeRuntime();
    const promise = probeCompanion(fake.runtime, new AbortController().signal);
    expect(fake.port.postMessage.mock.calls[0]![0]).toMatchObject({
      method: 'hello',
      params: { extensionVersion: '0.7.0' },
    });
    fake.reply();
    expect(await promise).toEqual(diagnostics());
    expect(fake.port.disconnect).toHaveBeenCalledOnce();
    expect(fake.messages.size + fake.disconnects.size).toBe(0);
  });
  it.each([{ protocol: 2 }, { id: 'wrong' }, { kind: 'event' }, { error: {} }, { result: {} }])(
    'rejects malformed/incompatible replies %j',
    async (patch) => {
      const fake = fakeRuntime();
      const promise = probeCompanion(fake.runtime, new AbortController().signal);
      fake.reply(patch);
      await expect(promise).rejects.toThrow();
      expect(fake.port.disconnect).toHaveBeenCalledOnce();
    },
  );
  it('handles missing hosts and early disconnect without exposing native errors', async () => {
    const fake = fakeRuntime();
    const promise = probeCompanion(fake.runtime, new AbortController().signal);
    for (const fn of [...fake.disconnects]) fn();
    await expect(promise).rejects.toThrow('closed');
    expect(fake.port.disconnect).toHaveBeenCalledOnce();
  });
  it('times out and cancels without leaving native ports behind', async () => {
    vi.useFakeTimers();
    for (const cancel of [true, false]) {
      const fake = fakeRuntime(),
        controller = new AbortController();
      const promise = probeCompanion(fake.runtime, controller.signal);
      const rejected = expect(promise).rejects.toThrow(cancel ? 'canceled' : 'timed out');
      if (cancel) controller.abort();
      else await vi.advanceTimersByTimeAsync(10000);
      await rejected;
      expect(fake.port.disconnect).toHaveBeenCalledOnce();
      expect(fake.messages.size + fake.disconnects.size).toBe(0);
    }
  });
  it('validates dependency states and bounded fields', () => {
    expect(parseDiagnostics(diagnostics()).dependencies.ffmpeg.available).toBe(true);
    for (const patch of [
      { capabilities: [] },
      { companionVersion: 'x'.repeat(129) },
      {
        dependencies: {
          ...diagnostics().dependencies,
          ffmpeg: { available: true, status: 'missing' },
        },
      },
    ])
      expect(() => parseDiagnostics({ ...diagnostics(), ...patch })).toThrow();
  });
});
