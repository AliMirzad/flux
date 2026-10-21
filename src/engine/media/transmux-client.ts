import type { TransportPort, TransportOutput } from './transmux';
import { abortError, checkAbort } from '../speed/control';
export function createTransportWorker(signal: AbortSignal): TransportPort {
  checkAbort(signal);
  const worker = new Worker(new URL('./transmux-worker.ts', import.meta.url), { type: 'module' });
  let id = 0,
    closed = false;
  let pending: {
    resolve: (output?: TransportOutput) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const fail = (error: Error) => {
    const request = pending;
    pending = null;
    if (request) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    closed = true;
    worker.terminate();
    signal.removeEventListener('abort', abort);
  };
  const abort = () => fail(abortError());
  signal.addEventListener('abort', abort, { once: true });
  worker.onerror = () => fail(new Error('The TS converter stopped. Committed media is retained.'));
  worker.onmessageerror = () => fail(new Error('The TS converter returned an invalid message.'));
  worker.onmessage = (
    event: MessageEvent<{ id: number; error?: string; output?: TransportOutput }>,
  ) => {
    if (event.data.id !== id || !pending) return;
    if (event.data.error) {
      fail(new Error(event.data.error));
      return;
    }
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    request.resolve(event.data.output);
  };
  const request = (message: object, transfer: Transferable[] = []) => {
    checkAbort(signal);
    if (closed || pending)
      return Promise.reject(new Error('The TS converter is unavailable or busy.'));
    return new Promise<TransportOutput | undefined>((resolve, reject) => {
      pending = {
        resolve,
        reject,
        timer: setTimeout(
          () =>
            fail(
              new Error(
                'The TS converter exceeded its processing deadline. Committed media is retained.',
              ),
            ),
          10000,
        ),
      };
      try {
        worker.postMessage({ ...message, id: ++id }, transfer);
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Converter message failed.'));
      }
    });
  };
  return {
    async push(bytes) {
      const copy = Uint8Array.from(bytes);
      await request({ bytes: copy }, [copy.buffer]);
    },
    async finish(duration, index) {
      const output = await request({ duration, index });
      if (!output) throw new Error('The TS converter returned no media.');
      return output;
    },
    close() {
      fail(abortError());
    },
  };
}
