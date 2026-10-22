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
    .getByText('Connected to companion 0.1.0 on darwin. Media inspection available.', {
      exact: true,
    })
    .waitFor();
  console.log('PASS: real Chrome manager UI -> native host handshake and dependency diagnostics.');
  if (process.env.COMPANION_SAMPLE_URL) {
    await page.getByLabel('Media URL', { exact: true }).fill(process.env.COMPANION_SAMPLE_URL);
    await page.getByRole('button', { name: 'Inspect media', exact: true }).click();
    await page
      .getByRole('button', { name: 'Inspecting media…', exact: true })
      .waitFor({ timeout: 3000 });
    await page.getByLabel('Available format', { exact: true }).waitFor({ timeout: 95000 });
    const formats = await page
      .getByLabel('Available format', { exact: true })
      .locator('option')
      .count();
    if (formats < 1 || formats > 200)
      throw new Error('Invalid number of displayed media selections.');
    console.log(`PASS: real inspection displayed ${formats} bounded media selection(s).`);
    if (process.env.COMPANION_SCREENSHOT)
      await page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Inspect media', exact: true }) })
        .screenshot({ path: process.env.COMPANION_SCREENSHOT });
    const other = await context.newPage();
    await other.goto(`chrome-extension://${id}/manager.html`);
    await other.getByRole('button', { name: 'Settings', exact: true }).click();
    await other.getByRole('button', { name: 'Check companion connection', exact: true }).click();
    await other.getByRole('alert').filter({ hasText: 'Another Flux tab' }).waitFor();
    await other.close();
    console.log('PASS: a displayed review prevents another tab from taking companion ownership.');
    await page.getByRole('button', { name: 'Close review', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect media', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel inspection', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect media', exact: true }).waitFor();
    if (await page.getByLabel('Available format', { exact: true }).count())
      throw new Error('Canceled inspection retained a stale review.');
    console.log('PASS: cancel returns to the inspection form without a stale review.');
    await page.getByLabel('Media URL', { exact: true }).fill('http://127.0.0.1/video');
    await page.getByRole('button', { name: 'Inspect media', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'public HTTP(S)' }).waitFor();
    console.log('PASS: private source URL rejected through the real native connection.');
  }
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
      .getByText('Connected to companion 0.1.0 on darwin. Media inspection available.', {
        exact: true,
      })
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
