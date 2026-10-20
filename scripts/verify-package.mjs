import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
const root = 'dist';
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const fail = (message) => {
  throw new Error(message);
};
if (manifest.manifest_version !== 3) fail('Release must use Manifest V3.');
if (manifest.host_permissions?.length) fail('Release must not pregrant remote host access.');
if (manifest.externally_connectable || manifest.web_accessible_resources)
  fail('Unexpected external extension entrypoint.');
const allowed = new Set([
  'storage',
  'downloads',
  'contextMenus',
  'alarms',
  'activeTab',
  'scripting',
  'webRequest',
]);
if (manifest.permissions.some((permission) => !allowed.has(permission)))
  fail('Unexpected packaged permission.');
const csp = manifest.content_security_policy.extension_pages;
if (
  csp.includes("'unsafe-eval'") ||
  !csp.includes("script-src 'self' 'wasm-unsafe-eval'") ||
  !csp.includes("object-src 'none'")
)
  fail('Unexpected executable CSP.');
let bytes = 0;
let files = 0;
async function inspect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) await inspect(target);
    else {
      files++;
      bytes += (await stat(target)).size;
      if (/\.(js|html)$/.test(entry.name)) {
        const source = await readFile(target, 'utf8');
        if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source))
          fail(`Dynamic JavaScript execution in ${target}`);
        if (/(?:src|href)\s*=\s*["']https?:/i.test(source) && entry.name.endsWith('.html'))
          fail(`Remote HTML asset in ${target}`);
      }
    }
  }
}
await inspect(root);
for (const file of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  'manager.html',
  'THIRD_PARTY_NOTICES.txt',
  ...Object.values(manifest.icons),
])
  await stat(join(root, file));
for (const icon of Object.values(manifest.icons)) {
  const png = await readFile(join(root, icon));
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('Invalid PNG icon.');
}
console.log(
  `Release audit passed: ${files} files, ${(bytes / 1024).toFixed(1)} KiB, MV3, optional hosts, local executable assets.`,
);
