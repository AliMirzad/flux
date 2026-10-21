import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { startFixture, fixtureHash } from '../fixtures/server';
import type { Snapshot, DownloadJob } from '../../src/domain/model';
let fixture: Awaited<ReturnType<typeof startFixture>>,
  context: BrowserContext,
  root: string,
  id: string,
  manager: Page,
  site: Page,
  base: string;
const snapshot = () =>
  manager.evaluate(
    async () => (await chrome.runtime.sendMessage({ type: 'snapshot' })) as Snapshot,
  );
const jobs = async () => (await snapshot()).jobs;
const browserItems = () => manager.evaluate(() => chrome.downloads.search({}));
async function waitReady(url: string, size: number) {
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === url)?.state, { timeout: 45000 })
    // Category auto-save exports verified files, so ready jobs may already be COMPLETED.
    .toMatch(/^(ASSEMBLING|COMPLETED)$/);
  const job = (await jobs()).find((job) => job.url === url)!;
  expect(job.sha256).toBe(fixtureHash(size));
  return job;
}
test.beforeAll(async () => {
  fixture = await startFixture();
  base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
  root = await mkdtemp(join(tmpdir(), 'flux-capture-'));
  await mkdir(join(root, 'profile', 'Default'), { recursive: true });
  await mkdir(join(root, 'downloads'), { recursive: true });
  await writeFile(
    join(root, 'profile', 'Default', 'Preferences'),
    JSON.stringify({
      download: { default_directory: join(root, 'downloads'), prompt_for_download: false },
    }),
  );
  const extension = join(root, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://*/*', 'https://*/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const executablePath = process.env.CHROME_PATH;
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    headless: true,
    executablePath,
    channel: executablePath ? undefined : 'chromium',
    acceptDownloads: true,
    downloadsPath: join(root, 'downloads'),
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      ...(executablePath
        ? []
        : [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]),
      '--enable-unsafe-extension-debugging',
      '--no-proxy-server',
      '--host-resolver-rules=MAP downloads.example.com 127.0.0.1, MAP cdn.example.com 127.0.0.1',
      '--disable-features=LocalNetworkAccessChecks',
    ],
  });
  if (executablePath) {
    const cdp = await context.browser()!.newBrowserCDPSession();
    id = (await cdp.send('Extensions.loadUnpacked', { path: extension })).id;
    await cdp.detach();
  } else {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    id = new URL(sw.url()).host;
  }
  manager = await context.newPage();
  await manager.goto(`chrome-extension://${id}/manager.html`);
  await expect(manager.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  site = await context.newPage();
  await site.goto(`${base}/capture-page`);
});
test.afterAll(async () => {
  await context?.close();
  await fixture?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
test('a captured link opens the Add Download window and starts only after Start Download', async () => {
  await manager.getByRole('button', { name: 'Enable automatic downloads', exact: true }).click();
  await manager.evaluate(() => chrome.runtime.sendMessage({ type: 'configure-offers' }));
  const url = new URL((await site.locator('#normal').getAttribute('href'))!, base).href;
  await site.reload();
  await site.locator('#normal').click();
  const popup = await context.newPage();
  await expect
    .poll(
      async () => {
        await popup.goto(`chrome-extension://${id}/popup.html`);
        return popup.getByLabel('Download URL').count();
      },
      { timeout: 20000 },
    )
    .toBe(1);
  await expect(popup.getByRole('heading', { name: 'Add Download' })).toBeVisible();
  await expect(popup.getByLabel('Download URL')).toHaveValue(url);
  await popup.screenshot({ path: 'test-results/screenshots/capture-dialog.png' });
  await popup.getByRole('button', { name: 'Start Download', exact: true }).click();
  await waitReady(url, 1048576);
  await popup.close();
});
