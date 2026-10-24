import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFixture, fixtureHash } from '../fixtures/server';
import type { Snapshot } from '../../src/domain/model';
let fixture: Awaited<ReturnType<typeof startFixture>>,
  context: BrowserContext,
  page: Page,
  root: string,
  base: string;
test.beforeAll(async () => {
  fixture = await startFixture();
  base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
  root = await mkdtemp(join(tmpdir(), 'flux-crawl-'));
  const extension = join(root, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://downloads.example.com/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const executablePath = process.env.CHROME_PATH;
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    headless: true,
    executablePath,
    channel: executablePath ? undefined : 'chromium',
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
  let id: string;
  if (executablePath) {
    const cdp = await context.browser()!.newBrowserCDPSession();
    id = (await cdp.send('Extensions.loadUnpacked', { path: extension })).id;
    await cdp.detach();
  } else
    id = new URL(
      (context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))).url(),
    ).host;
  page = await context.newPage();
  await page.goto(`chrome-extension://${id}/manager.html`);
  await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Automatically save finished downloads').uncheck();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByRole('button', { name: /^All downloads/ }).click();
});
test.afterAll(async () => {
  await context?.close();
  await fixture?.close();
  if (root && root.startsWith(join(tmpdir(), 'flux-crawl-')))
    await rm(root, { recursive: true, force: true });
});
test('recursive site scan respects boundaries and hands only selected results to a real verified transfer', async () => {
  await page.getByRole('button', { name: 'Crawl website', exact: true }).click();
  await page.getByLabel('Crawler starting URL').fill(base + '/crawl/index.html');
  await page.getByRole('button', { name: 'Scan website', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Review found downloads', exact: true }),
  ).toBeEnabled();
  expect(fixture.stats.paths).toContain('/crawl/deep/end.html');
  expect(fixture.stats.paths).not.toContain('/crawl/private/blocked.html');
  expect(fixture.stats.paths).not.toContain('/crawl/script.js');
  expect(fixture.stats.paths).not.toContain('/crawl/escaped.html');
  expect(fixture.stats.paths).not.toContain('/internal.png');
  await page.getByRole('button', { name: 'Review found downloads', exact: true }).click();
  await page.getByLabel('Filter links', { exact: true }).fill('crawl-archive.zip');
  await page.getByLabel('Add paused', { exact: true }).check();
  await page.getByRole('button', { name: 'Add selected downloads', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('1 added; 0 already queued.');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Resume crawl-archive.zip', exact: true }).click();
  await expect
    .poll(async () => {
      const value = await page.evaluate(
        async () => (await chrome.runtime.sendMessage({ type: 'snapshot' })) as Snapshot,
      );
      return value.jobs.find((job) => job.filename === 'crawl-archive.zip')?.sha256;
    })
    .toBe(fixtureHash(131072));
});
