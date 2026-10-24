import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { withSHA256 } from '../../src/engine/hash';

it('keeps concurrent digests independent and clears canceled state before repeated reuse', async () => {
  const messages = Array.from({ length: 24 }, (_, index) => `independent-${index}`);
  const results = await Promise.all(
    messages.map((message) =>
      withSHA256(async (hash) => {
        hash.update(message.slice(0, 5));
        await new Promise((resolve) => setTimeout(resolve, 1));
        hash.update(message.slice(5));
        return hash.digest('hex');
      }),
    ),
  );
  expect(results).toEqual(
    messages.map((message) => createHash('sha256').update(message).digest('hex')),
  );
  for (let index = 0; index < 1000; index++) {
    if (index % 10 === 0)
      await expect(
        withSHA256((hash) => {
          hash.update('uncommitted sensitive input');
          throw new DOMException('Canceled', 'AbortError');
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    const message = `reused-${index}`;
    expect(
      await withSHA256((hash) => {
        hash.update(message);
        return hash.digest('hex');
      }),
    ).toBe(createHash('sha256').update(message).digest('hex'));
  }
});
