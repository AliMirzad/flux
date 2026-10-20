import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
await mkdir('.bench', { recursive: true });
await build({
  entryPoints: ['tests/performance/benchmark.ts'],
  outfile: '.bench/run.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
});
await import(pathToFileURL(resolve('.bench/run.mjs')).href);
