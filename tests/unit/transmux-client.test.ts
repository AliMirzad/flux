import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransportWorker } from '../../src/engine/media/transmux-client';

class Child {
  static instances: Child[] = [];
  onmessage: ((event: { data: object }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    Child.instances.push(this);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  Child.instances = [];
  vi.stubGlobal('Worker', Child);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('isolated TS converter lifetime', () => {
  it('terminates a stalled child at its processing deadline and refuses later work', async () => {
    const port = createTransportWorker(new AbortController().signal),
      child = Child.instances[0]!;
    const pending = expect(port.push(new Uint8Array([1]))).rejects.toThrow(/deadline/);
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    expect(child.terminate).toHaveBeenCalledTimes(1);
    await expect(port.finish(1, 0)).rejects.toThrow(/unavailable/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels pending conversion immediately and releases its deadline timer', async () => {
    const controller = new AbortController(),
      port = createTransportWorker(controller.signal);
    const pending = expect(port.push(new Uint8Array([1]))).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await pending;
    expect(Child.instances[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores stale replies, transfers an owned copy and clears an acknowledged deadline', async () => {
    const port = createTransportWorker(new AbortController().signal),
      child = Child.instances[0]!;
    const bytes = new Uint8Array([1, 2, 3]),
      pending = port.push(bytes);
    const [message, transfer] = child.postMessage.mock.calls[0]! as unknown as [
      { id: number; bytes: Uint8Array },
      Transferable[],
    ];
    expect(message.bytes).toEqual(bytes);
    expect(message.bytes.buffer).not.toBe(bytes.buffer);
    expect(transfer).toEqual([message.bytes.buffer]);
    child.onmessage!({ data: { id: message.id - 1 } });
    expect(vi.getTimerCount()).toBe(1);
    child.onmessage!({ data: { id: message.id } });
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    port.close();
    expect(child.terminate).toHaveBeenCalledTimes(1);
  });
});
