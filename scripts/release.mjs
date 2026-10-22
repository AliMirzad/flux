import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createZip } from './zip.mjs';

async function filesIn(directory, prefix = '') {
  const entries = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) entries.push(...(await filesIn(path, name + '/')));
    else if (entry.isFile()) entries.push({ name, path });
    else throw new Error('Release may only contain regular files.');
  }
  return entries;
}
const files = await filesIn('dist');
const archive = await createZip(files);
await mkdir('releases', { recursive: true });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const zip = resolve(`releases/flux-${pkg.version}.zip`);
await writeFile(zip, archive);
const digest = createHash('sha256').update(archive).digest('hex');
await writeFile(`${zip}.sha256`, `${digest}  flux-${pkg.version}.zip\n`);
console.log(`Created ${zip}\n${files.length} files, ${archive.length} bytes\nSHA-256 ${digest}`);
