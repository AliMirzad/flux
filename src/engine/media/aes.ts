import type { HlsEncryption } from './hls';
import { mediaRequest, readMediaBody, type MediaNetwork } from './network';
import { numberHeader } from '../network/http';
import { checkAbort } from '../speed/control';

export const maxEncryptedPartBytes = 16 * 1024 * 1024;
/** Fixed-size blocks bound both byte storage and object count for tiny network chunks. */
export class HlsCiphertext {
  private blocks: Uint8Array[] = [];
  size = 0;
  append(bytes: Uint8Array) {
    if (this.size + bytes.length > maxEncryptedPartBytes + 16)
      throw new Error('An encrypted HLS part exceeds the 16 MiB limit.');
    const blockSize = 262144;
    for (let at = 0; at < bytes.length;) {
      const index = Math.floor(this.size / blockSize),
        offset = this.size % blockSize;
      const block =
        this.blocks[index] ??
        (this.blocks[index] = new Uint8Array(
          Math.min(blockSize, maxEncryptedPartBytes + 16 - index * blockSize),
        ));
      const count = Math.min(bytes.length - at, block.length - offset);
      block.set(bytes.subarray(at, at + count), offset);
      this.size += count;
      at += count;
    }
  }
  drain() {
    const input = new Uint8Array(this.size);
    let at = 0;
    for (const block of this.blocks) {
      const count = Math.min(block.length, this.size - at);
      input.set(block.subarray(0, count), at);
      at += count;
    }
    this.clear();
    return input;
  }
  clear() {
    this.blocks = [];
    this.size = 0;
  }
}
export async function loadHlsKey(
  encryption: HlsEncryption,
  options: MediaNetwork,
  consume: (bytes: number) => Promise<void>,
) {
  const response = await mediaRequest(encryption.url, {}, options);
  const bytes = new Uint8Array(16);
  try {
    const encoding = response.headers.get('content-encoding'),
      size = numberHeader(response.headers.get('content-length'));
    if (
      response.status !== 200 ||
      (encoding && encoding !== 'identity') ||
      (size !== null && size !== 16)
    )
      throw new Error('An identity AES-128 HLS key must contain exactly 16 bytes.');
    let at = 0;
    await readMediaBody(response, options.signal, async (chunk) => {
      if (at + chunk.length > 16)
        throw new Error('An identity AES-128 HLS key must contain exactly 16 bytes.');
      await consume(chunk.length);
      checkAbort(options.signal);
      bytes.set(chunk, at);
      at += chunk.length;
    });
    if (at !== 16) throw new Error('The HLS AES-128 key is truncated.');
    // Keys have a fixed 16-byte size; keep raw key input out of reusable WASM scratch memory.
    const fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-CBC', false, ['decrypt']);
    checkAbort(options.signal);
    return { key, hash: fingerprint };
  } finally {
    bytes.fill(0);
    await response.body?.cancel().catch(() => undefined);
  }
}

export async function decryptHlsPart(
  ciphertext: HlsCiphertext,
  key: CryptoKey,
  iv: string,
  signal: AbortSignal,
) {
  checkAbort(signal);
  const size = ciphertext.size;
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size % 16 ||
    size > maxEncryptedPartBytes + 16 ||
    !/^[a-f\d]{32}$/.test(iv)
  )
    throw new Error(
      'Invalid AES-128 HLS ciphertext size or IV. Encrypted parts are limited to 16 MiB.',
    );
  const input = ciphertext.drain(),
    vector = new Uint8Array(16);
  for (let index = 0; index < 16; index++)
    vector[index] = parseInt(iv.slice(index * 2, index * 2 + 2), 16);
  let output: Uint8Array;
  try {
    output = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CBC', iv: vector }, key, input),
    );
  } catch {
    throw new Error('The HLS AES-128 part could not be decrypted. Check the key and source.');
  } finally {
    input.fill(0);
  }
  checkAbort(signal);
  return output;
}
