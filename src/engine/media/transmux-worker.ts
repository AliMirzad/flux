import { TransportConverter } from './transmux';
import { safeError } from '../../shared/security';
const converter = new TransportConverter();
self.onmessage = (
  event: MessageEvent<{ id: number; bytes?: Uint8Array; duration?: number; index?: number }>,
) => {
  const message = event.data;
  try {
    if (message.bytes) {
      converter.push(message.bytes);
      postMessage({ id: message.id });
    } else {
      const output = converter.finish(message.duration!, message.index!);
      postMessage(
        { id: message.id, output },
        {
          transfer: [
            output.initialization.buffer as ArrayBuffer,
            output.media.buffer as ArrayBuffer,
          ],
        },
      );
    }
  } catch (error) {
    postMessage({ id: message.id, error: safeError(error) });
  }
};
