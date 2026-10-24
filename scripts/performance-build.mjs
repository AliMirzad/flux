import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export async function runPerformance(entry, name) {
  await mkdir('.bench', { recursive: true });
  const outfile = `.bench/${name}.mjs`;
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node24',
    plugins: [
      {
        name: 'fixture-resource-paths',
        setup(build) {
          build.onLoad({ filter: /tests[\\/]fixtures[\\/][^\\/]+\.ts$/ }, async ({ path }) => ({
            contents: (await readFile(path, 'utf8')).replaceAll(
              'import.meta.url',
              JSON.stringify(pathToFileURL(path).href),
            ),
            loader: 'ts',
          }));
        },
      },
    ],
  });
  await import(pathToFileURL(resolve(outfile)).href);
}
