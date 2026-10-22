// Explicit macOS acceptance check. Existing registrations are never overwritten.
import { chromium } from 'playwright-core';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin') throw new Error('This acceptance check requires macOS.');
const root = await mkdtemp(join(tmpdir(), 'flux-companion-acceptance-'));
const extension = join(root, 'extension');
const hostDir = join(root, 'host');
const manifestDir = join(root, 'profile', 'NativeMessagingHosts');
const python = process.env.PYTHON_PATH ?? 'python3';
const installer = resolve('companion/install.py');
let context;
let page;
let registered = false;
try {
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // Pregrant only in this disposable test package. The release asks on gesture.
  manifest.optional_permissions = manifest.optional_permissions.filter(
    (p) => p !== 'nativeMessaging',
  );
  manifest.permissions.push('nativeMessaging');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    executablePath:
      process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  const session = await context.browser().newBrowserCDPSession();
  const { id } = await session.send('Extensions.loadUnpacked', { path: extension });
  await session.detach();
  execFileSync(
    python,
    [
      installer,
      'install',
      '--extension-id',
      id,
      '--host-dir',
      hostDir,
      '--manifest-dir',
      manifestDir,
    ],
    { stdio: 'pipe' },
  );
  registered = true;
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`chrome-extension://${id}/manager.html`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Check companion connection', exact: true }).click();
  await page
    .getByText('Connected to companion 0.1.0 on darwin. Diagnostics only.', { exact: true })
    .waitFor();
  console.log('PASS: real Chrome manager UI -> native host handshake and dependency diagnostics.');
  execFileSync(
    python,
    [installer, 'uninstall', '--host-dir', hostDir, '--manifest-dir', manifestDir],
    { stdio: 'pipe' },
  );
  registered = false;
  await page.getByRole('button', { name: 'Check companion connection', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Connection failed.' }).waitFor();
  if (
    await page
      .getByText('Connected to companion 0.1.0 on darwin. Diagnostics only.', { exact: true })
      .count()
  )
    throw new Error('Stale connection diagnostics remained visible.');
  console.log('PASS: missing native host displays actionable failure and clears old diagnostics.');
  console.log(`Chrome ${context.browser().version()}; temporary native registration removed.`);
} catch (error) {
  console.error('Connection UI:', await page?.getByRole('alert').allTextContents());
  throw error;
} finally {
  await context?.close();
  if (registered)
    execFileSync(
      python,
      [installer, 'uninstall', '--host-dir', hostDir, '--manifest-dir', manifestDir],
      { stdio: 'pipe' },
    );
  await rm(root, { recursive: true, force: true });
}
