import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createZip } from './zip.mjs';

const files = ['host.py', 'install.py', 'configure.py', 'requirements.txt'];
async function sources(directory) {
  for (const entry of (await readdir(join('companion', directory), { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== '__pycache__') await sources(path);
    else if (entry.isFile() && entry.name.endsWith('.py')) files.push(path);
  }
}
await sources('flux_companion');
const entries = files.map((name) => ({
  name: `Flux Media Companion/${name}`,
  path: join('companion', name),
}));
entries.push({ name: 'Flux Media Companion/README.md', path: 'companion/macos/README.md' });
for (const name of ['Install.command', 'Choose save folder.command', 'Uninstall.command'])
  entries.push({
    name: `Flux Media Companion/${name}`,
    path: join('companion/macos', name),
    mode: 0o100755,
  });
await mkdir('dist/companion', { recursive: true });
await writeFile('dist/companion/flux-media-companion-macos.zip', await createZip(entries));
await writeFile(
  'dist/companion/flux-media-folder-setup-macos.zip',
  await createZip([
    {
      name: 'Choose save folder.command',
      path: 'companion/macos/Choose save folder.command',
      mode: 0o100755,
    },
  ]),
);
console.log('Packaged macOS companion installer and local folder chooser.');
