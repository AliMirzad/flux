import { TransportConverter } from './transmux';
import { safeError } from '../../shared/security';
let converter: TransportConverter | undefined;
self.onmessage = (
  event: MessageEvent<{
    id: number;
    bytes?: Uint8Array;
    duration?: number;
    index?: number;
    initialization?: Uint8Array;
    discontinuity?: boolean;
  }>,
) => {
  const message = event.data;
  try {
    converter ??= new TransportConverter(message.initialization, message.discontinuity);
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
