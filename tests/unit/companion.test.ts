import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  companionReloadMessage,
  inspectCompanion,
  listCompanionDestinations,
  parseDestinations,
  parseDiagnostics,
  parseReview,
  probeCompanion,
} from '../../src/application/companion';

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
describe('companion destination boundary', () => {
  it('lists approved handles after capability negotiation, projects fields and closes its port', async () => {
    const fake = fakeRuntime();
    const promise = listCompanionDestinations(fake.runtime, new AbortController().signal);
    inspectReply(fake, { ...diagnostics(), capabilities: ['diagnostics', 'destinations.list'] });
    expect(fake.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      method: 'destinations.list',
      params: {},
    });
    inspectReply(fake, [{ id: 'opaque-folder', label: 'Videos', path: '/private/not-for-chrome' }]);
    expect(await promise).toEqual([{ id: 'opaque-folder', label: 'Videos' }]);
    expect(fake.port.disconnect).toHaveBeenCalledOnce();
    expect(fake.messages.size + fake.disconnects.size).toBe(0);
  });
  it('keeps older companion versions usable and explains the folder capability upgrade', async () => {
    const fake = fakeRuntime();
    const promise = listCompanionDestinations(fake.runtime, new AbortController().signal);
    inspectReply(fake, diagnostics());
    await expect(promise).rejects.toThrow('Reinstall');
    expect(fake.port.postMessage).toHaveBeenCalledOnce();
  });
  it('accepts empty listings and rejects duplicates, oversized and malformed handles', () => {
    expect(parseDestinations([])).toEqual([]);
    for (const value of [
      {},
      [{ id: '', label: 'Videos' }],
      [{ id: 'folder', label: '' }],
      [{ id: 'folder', label: 'a'.repeat(129) }],
      [
        { id: 'folder', label: 'A' },
        { id: 'folder', label: 'B' },
      ],
      Array.from({ length: 51 }, (_, index) => ({ id: String(index), label: 'Folder' })),
    ])
      expect(() => parseDestinations(value)).toThrow('invalid save folders');
  });
  it('redacts local storage errors and rejects responses for another request', async () => {
    for (const wrongId of [true, false]) {
      const fake = fakeRuntime();
      const promise = listCompanionDestinations(fake.runtime, new AbortController().signal);
      inspectReply(fake, { ...diagnostics(), capabilities: ['diagnostics', 'destinations.list'] });
      const request = fake.port.postMessage.mock.calls.at(-1)![0];
      for (const fn of [...fake.messages])
        fn({
          protocol: 1,
          kind: 'response',
          id: wrongId ? 'wrong-id' : request.id,
          error: { message: '/private/secret/database' },
        });
      await expect(promise).rejects.toThrow(
        wrongId ? 'invalid folder response' : 'Could not read approved folders',
      );
      expect(fake.port.disconnect).toHaveBeenCalledOnce();
    }
  });
  it('cancels and times out without leaving a connection behind', async () => {
    vi.useFakeTimers();
    for (const canceled of [true, false]) {
      const fake = fakeRuntime();
      const controller = new AbortController();
      const promise = listCompanionDestinations(fake.runtime, controller.signal);
      const rejected = expect(promise).rejects.toThrow(canceled ? 'canceled' : 'timed out');
      if (canceled) controller.abort();
      else await vi.advanceTimersByTimeAsync(10000);
      await rejected;
      expect(fake.port.disconnect).toHaveBeenCalledOnce();
      expect(fake.messages.size + fake.disconnects.size).toBe(0);
    }
  });
  it('handles native disconnect and already-canceled operations', async () => {
    const fake = fakeRuntime();
    const controller = new AbortController();
    const promise = listCompanionDestinations(fake.runtime, controller.signal);
    for (const fn of [...fake.disconnects]) fn();
    await expect(promise).rejects.toThrow('Could not connect');
    controller.abort();
    await expect(listCompanionDestinations(fake.runtime, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fake.runtime.connectNative).toHaveBeenCalledOnce();
  });
});
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

const review = () => ({
  reviewId: 'review',
  expiresAt: Date.now() + 600000,
  title: 'Sample',
  duration: 12.5,
  truncated: false,
  formats: [
    {
      selectionId: 'opaque',
      label: '720p without audio',
      container: 'mp4',
      height: 720,
      hasVideo: true,
      hasAudio: false,
    },
  ],
});

function inspectReply(fake: ReturnType<typeof fakeRuntime>, result: unknown) {
  const request = fake.port.postMessage.mock.calls.at(-1)![0];
  for (const fn of [...fake.messages])
    fn({ protocol: 1, kind: 'response', id: request.id, result });
}

describe('companion inspection boundary', () => {
  it('negotiates capability, validates a review, and retains ownership until abort', async () => {
    const fake = fakeRuntime();
    const controller = new AbortController();
    const promise = inspectCompanion(fake.runtime, 'https://example.com/watch', controller.signal);
    inspectReply(fake, { ...diagnostics(), capabilities: ['diagnostics', 'inspect'] });
    expect(fake.port.postMessage.mock.calls[1]![0]).toMatchObject({
      method: 'inspect',
      params: { url: 'https://example.com/watch' },
    });
    const value = review();
    inspectReply(fake, value);
    expect(await promise).toEqual(value);
    expect(fake.port.disconnect).not.toHaveBeenCalled();
    controller.abort();
    expect(fake.port.disconnect).toHaveBeenCalledOnce();
    expect(fake.messages.size + fake.disconnects.size).toBe(0);
  });
  it('does not send URLs to a diagnostics-only companion', async () => {
    const fake = fakeRuntime();
    const promise = inspectCompanion(
      fake.runtime,
      'https://example.com/watch',
      new AbortController().signal,
    );
    inspectReply(fake, diagnostics());
    await expect(promise).rejects.toThrow('supports media inspection');
    expect(fake.port.postMessage).toHaveBeenCalledOnce();
  });
  it('cancels the native port during extraction and removes listeners', async () => {
    const fake = fakeRuntime();
    const controller = new AbortController();
    const promise = inspectCompanion(fake.runtime, 'https://example.com/watch', controller.signal);
    inspectReply(fake, { ...diagnostics(), capabilities: ['diagnostics', 'inspect'] });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.port.disconnect).toHaveBeenCalledOnce();
    expect(fake.messages.size + fake.disconnects.size).toBe(0);
  });
  it('invalidates an already displayed review after disconnect', async () => {
    const fake = fakeRuntime();
    const disconnected = vi.fn();
    const promise = inspectCompanion(
      fake.runtime,
      'https://example.com/watch',
      new AbortController().signal,
      disconnected,
    );
    inspectReply(fake, { ...diagnostics(), capabilities: ['diagnostics', 'inspect'] });
    inspectReply(fake, review());
    await promise;
    for (const fn of [...fake.disconnects]) fn();
    expect(disconnected).toHaveBeenCalledOnce();
  });
  it('rejects malformed, oversized and stale reviews and drops extractor internals', () => {
    const value = review();
    for (const patch of [
      { formats: [] },
      { duration: Infinity },
      { truncated: 'yes' },
      { formats: [...value.formats, ...value.formats] },
      { formats: Array(201).fill(value.formats[0]) },
      { formats: [{ ...value.formats[0], hasAudio: 'unknown' }] },
    ])
      expect(() => parseReview({ ...value, ...patch })).toThrow();
    expect(parseReview({ ...value, signedUrl: 'private', plans: { secret: 'private' } })).toEqual(
      value,
    );
    const unknown = {
      ...value,
      formats: [{ ...value.formats[0]!, hasVideo: null, hasAudio: null }],
    };
    expect(parseReview(unknown).formats[0]!.hasAudio).toBeNull();
  });
  it('redacts native extractor errors', async () => {
    const fake = fakeRuntime();
    const promise = inspectCompanion(
      fake.runtime,
      'https://example.com/watch',
      new AbortController().signal,
    );
    inspectReply(fake, { ...diagnostics(), capabilities: ['diagnostics', 'inspect'] });
    const request = fake.port.postMessage.mock.calls[1]![0];
    for (const fn of [...fake.messages])
      fn({
        protocol: 1,
        kind: 'response',
        id: request.id,
        error: { code: 'EXTRACTION_FAILED', message: 'signed secret URL' },
      });
    await expect(promise).rejects.toThrow('Could not inspect this media.');
  });
  it('enforces the inspection deadline and closes the port', async () => {
    vi.useFakeTimers();
    const fake = fakeRuntime();
    const promise = inspectCompanion(
      fake.runtime,
      'https://example.com/watch',
      new AbortController().signal,
    );
    inspectReply(fake, { ...diagnostics(), capabilities: ['diagnostics', 'inspect'] });
    const rejected = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(90000);
    await rejected;
    expect(fake.port.disconnect).toHaveBeenCalledOnce();
  });
});

describe('native messaging permission activation', () => {
  it('offers reload recovery for every operation when an open page lacks the native API', async () => {
    const runtime = { getManifest: () => ({ version: '0.7.0' }) } as Parameters<
      typeof probeCompanion
    >[0];
    const signal = new AbortController().signal;
    for (const operation of [
      () => probeCompanion(runtime, signal),
      () => listCompanionDestinations(runtime, signal),
      () => inspectCompanion(runtime, 'https://example.com/video', signal, () => {}),
    ])
      await expect(operation()).rejects.toThrow(companionReloadMessage);
  });
  it('preserves cancellation when the native API is unavailable', async () => {
    const runtime = {} as Parameters<typeof probeCompanion>[0];
    const controller = new AbortController();
    controller.abort();
    for (const operation of [
      () => probeCompanion(runtime, controller.signal),
      () => listCompanionDestinations(runtime, controller.signal),
      () => inspectCompanion(runtime, 'https://example.com/video', controller.signal, () => {}),
    ])
      await expect(operation()).rejects.toMatchObject({ name: 'AbortError' });
  });
});

it('explains blocked network destinations without forwarding native error details', async () => {
  const fake = fakeRuntime();
  const result = inspectCompanion(
    fake.runtime,
    'https://example.com/video',
    new AbortController().signal,
  );
  inspectReply(fake, {
    ...diagnostics(),
    capabilities: ['diagnostics', 'inspect', 'inspect.cancel'],
  });
  const request = fake.port.postMessage.mock.calls.at(-1)![0];
  for (const callback of [...fake.messages])
    callback({
      protocol: 1,
      kind: 'response',
      id: request.id,
      error: { code: 'NETWORK_BLOCKED', message: 'private signed URL and credentials' },
    });
  await expect(result).rejects.toThrow('does not inherit Chrome proxy settings');
  expect(fake.port.disconnect).toHaveBeenCalledOnce();
});
