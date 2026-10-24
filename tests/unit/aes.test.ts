import { it, expect } from 'vitest';
import { createCipheriv } from 'node:crypto';
import { decryptHlsPart, HlsCiphertext, maxEncryptedPartBytes } from '../../src/engine/media/aes';

it('decrypts arbitrarily tiny CBC chunks across fixed buffer boundaries and rejects invalid padding', async () => {
  const keyBytes = new Uint8Array(16).fill(42),
    iv = new Uint8Array(16).fill(17);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
  const source = new Uint8Array(262145);
  source.forEach((_, at) => {
    source[at] = at % 251;
  });
  const cipher = createCipheriv('aes-128-cbc', keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(source), cipher.final()]);
  const buffer = new HlsCiphertext();
  for (let at = 0; at < encrypted.length; at++) buffer.append(encrypted.subarray(at, at + 1));
  expect(buffer.size).toBe(encrypted.length);
  const output = await decryptHlsPart(
    buffer,
    key,
    Buffer.from(iv).toString('hex'),
    new AbortController().signal,
  );
  expect(output).toEqual(source);
  expect(buffer.size).toBe(0);
  encrypted[encrypted.length - 17]! ^= 128;
  buffer.append(encrypted);
  await expect(
    decryptHlsPart(buffer, key, Buffer.from(iv).toString('hex'), new AbortController().signal),
  ).rejects.toThrow(/could not be decrypted/);
  expect(() => buffer.append(new Uint8Array(maxEncryptedPartBytes + 17))).toThrow(/16 MiB/);
});
