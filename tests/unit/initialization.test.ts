import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assertCompatibleInitialization } from '../../src/engine/media/initialization';

it('permits movie dates but refuses changed fragment defaults across media periods', async () => {
  const original = await readFile(new URL('../fixtures/media/init.mp4', import.meta.url));
  const date = Buffer.from(original);
  date.writeUInt32BE(42, date.indexOf('mvhd') + 8);
  expect(() => assertCompatibleInitialization(original, date)).not.toThrow();
  const defaults = Buffer.from(original);
  const at = defaults.indexOf('trex') + 16;
  defaults.writeUInt32BE(defaults.readUInt32BE(at) + 1, at);
  expect(() => assertCompatibleInitialization(original, defaults)).toThrow(/fragment defaults/);
});
