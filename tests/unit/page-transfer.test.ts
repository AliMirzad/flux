import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PageTransfers,
  PAGE_CHUNK_BYTES,
  PAGE_FILE_LIMIT,
  validPageGrant,
  type PageTransferGrant,
} from '../../src/application/page-transfer';
const sender = {
  tab: { id: 12 },
  frameId: 2,
  documentId: 'document-a',
  url: 'https://example.org/page',
} as chrome.runtime.MessageSender;
const token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function setup(size = 3) {
  const grant: PageTransferGrant = {
    source: sender.url!,
    tabId: 12,
    frameId: 2,
    documentId: 'document-a',
    size,
    at: Date.now(),
  };
  let consumed = false;
  const sink = {
    id: 'file',
    write: vi.fn(async (_bytes: Uint8Array) => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const ports = {
    authorize: vi.fn(async (_token: string, source: chrome.runtime.MessageSender) => {
      if (consumed || !validPageGrant(grant, source)) throw new Error('Unauthorized');
      return grant;
    }),
    consume: vi.fn(async () => {
      consumed = true;
    }),
    open: vi.fn(async () => sink),
    remove: vi.fn(async () => {}),
    finish: vi.fn(async () => 'job'),
  };
  return { receiver: new PageTransfers(ports), ports, sink, grant };
}
const chunk = { type: 'blob-chunk', token, index: 0, data: 'YWJj' };
afterEach(() => vi.useRealTimers());
describe('page-file reception', () => {
  it('serializes orphan cleanup against new and in-progress page files', async () => {
    const { receiver, ports } = setup();
    let release!: () => void;
    const cleaning = receiver.whenIdle(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await expect(receiver.receive(chunk, sender)).rejects.toThrow('cleanup');
    expect(ports.open).not.toHaveBeenCalled();
    release();
    await cleaning;
    await receiver.receive(chunk, sender);
    await expect(receiver.whenIdle(async () => {})).rejects.toThrow('finish');
    await receiver.receive({ type: 'blob-done', token, size: 3 }, sender);
  });
  it('commits an empty generated file without inventing a payload chunk', async () => {
    const { receiver, sink, ports } = setup(0);
    await receiver.receive({ type: 'blob-done', token, size: 0 }, sender);
    expect(sink.write).not.toHaveBeenCalled();
    expect(ports.finish).toHaveBeenCalledOnce();
  });
  it('commits exact bytes once and refuses token replay', async () => {
    const { receiver, sink, ports } = setup();
    await receiver.receive(chunk, sender);
    expect([...sink.write.mock.calls[0]![0]]).toEqual([97, 98, 99]);
    expect(
      await receiver.receive({ type: 'blob-done', token, size: 3, filename: 'file.txt' }, sender),
    ).toEqual({ ok: true, id: 'job' });
    expect(sink.close).toHaveBeenCalledOnce();
    expect(ports.finish).toHaveBeenCalledOnce();
    await expect(receiver.receive(chunk, sender)).rejects.toThrow('Unauthorized');
    expect(receiver.pendingIds).toEqual([]);
  });
  it('binds tab, frame, document and page; a forged abort cannot damage the valid upload', async () => {
    const { receiver, grant, sink } = setup();
    await receiver.receive(chunk, sender);
    for (const changed of [
      { tab: { id: 13 } },
      { frameId: 3 },
      { documentId: 'new-document' },
      { url: 'https://evil.example/page' },
    ]) {
      const other = { ...sender, ...changed } as chrome.runtime.MessageSender;
      expect(validPageGrant(grant, other)).toBe(false);
      await expect(receiver.receive({ type: 'blob-abort', token }, other)).rejects.toThrow(
        'Unauthorized',
      );
    }
    expect(validPageGrant(grant, { ...sender, url: sender.url + '#section' })).toBe(true);
    expect(sink.abort).not.toHaveBeenCalled();
    await receiver.receive({ type: 'blob-done', token, size: 3 }, sender);
  });
  it.each([
    { ...chunk, data: 'a'.repeat(Math.ceil(PAGE_CHUNK_BYTES / 3) * 4 + 4) },
    { ...chunk, data: '@@@@' },
    { ...chunk, data: '' },
    { ...chunk, data: 'YWJjZA==' },
    { ...chunk, index: 1 },
    { type: 'blob-done', token, size: 3 },
  ])(
    'refuses malformed, oversized, out-of-order or incomplete input before opening storage',
    async (message) => {
      const { receiver, ports } = setup();
      await expect(receiver.receive(message, sender)).rejects.toThrow();
      expect(ports.open).not.toHaveBeenCalled();
      expect(ports.consume).toHaveBeenCalledOnce();
    },
  );
  it('backpressures concurrent messages without aborting the write already in progress', async () => {
    const { receiver, sink } = setup();
    let release!: () => void;
    sink.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = receiver.receive(chunk, sender);
    await vi.waitFor(() => expect(sink.write).toHaveBeenCalled());
    await expect(receiver.receive(chunk, sender)).rejects.toThrow('acknowledgement');
    expect(sink.abort).not.toHaveBeenCalled();
    release();
    await pending;
    await receiver.receive({ type: 'blob-done', token, size: 3 }, sender);
  });
  it('expires incomplete uploads and removes their private files', async () => {
    vi.useFakeTimers();
    const { receiver, ports, sink } = setup(6);
    await receiver.receive(chunk, sender);
    await vi.advanceTimersByTimeAsync(120001);
    expect(sink.abort).toHaveBeenCalledOnce();
    expect(ports.remove).toHaveBeenCalledWith('file');
    expect(receiver.pendingIds).toEqual([]);
    await expect(receiver.receive(chunk, sender)).rejects.toThrow('Unauthorized');
  });
  it('bounds authorized total size and expiry and removes failed output', async () => {
    const { receiver, ports, grant } = setup();
    expect(validPageGrant({ ...grant, size: PAGE_FILE_LIMIT + 1 }, sender)).toBe(false);
    expect(validPageGrant({ ...grant, at: Date.now() - 3600000 }, sender)).toBe(false);
    await receiver.receive(chunk, sender);
    ports.finish.mockRejectedValueOnce(new Error('Storage failed'));
    await expect(receiver.receive({ type: 'blob-done', token, size: 3 }, sender)).rejects.toThrow(
      'Storage failed',
    );
    expect(ports.remove).toHaveBeenCalledWith('file');
    expect(receiver.pendingIds).toEqual([]);
  });
});
