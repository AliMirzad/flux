import { expect, it } from 'vitest';
import { fixtureBytes, fixtureHash } from '../fixtures/server';

it('generates the original absolute-offset bytes across period and 32-bit boundaries', () => {
  for (const offset of [0, 64255, 65530, 2 ** 32 - 7, 10 * 1024 ** 3 - 65536]) {
    const actual = fixtureBytes(offset, 65536);
    const reference = Uint8Array.from({ length: actual.length }, (_, index) => {
      const position = offset + index;
      return (position * 31 + Math.floor(position / 251) * 17) % 256;
    });
    expect(actual).toEqual(reference);
  }
  expect(fixtureHash(1024 ** 3)).toBe(
    '2b3cf829d1c2d055e601cf528ad61df6705ab1273dd5ae0aa8a77206d788f3b8',
  );
});
