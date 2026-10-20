import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, fixtureHash } from '../fixtures/server';
let context: BrowserContext, page: Page, root: string, id: string, base: string;
let fixture: Awaited<ReturnType<typeof startFixture>>;
test.beforeAll(async () => {
  fixture = await startFixture();
  base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
  root = await mkdtemp(join(tmpdir(), 'flux-redirects-'));
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
});
test.afterAll(async () => {
  await context?.close();
  await fixture?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function add(url: string, name: string) {
  await page.getByRole('button', { name: 'Add download', exact: true }).click();
  await page.getByLabel('Download URL').fill(url);
  await page.getByLabel('File name optional').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add download', exact: true }).click();
  return page
    .locator('.download-card')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
}
test('a single-origin grant resolves same-host redirects', async () => {
  const card = await add(`${base}/redirect?case=narrow`, 'narrow.bin');
  await expect(card.getByText('Ready to save', { exact: true })).toBeVisible();
});
test('a new CDN host requests permission instead of reporting unreadable redirect metadata', async () => {
  const target = `${base.replace('downloads.example.com', 'cdn.example.com')}/range?size=1048576&case=ungranted`;
  const card = await add(`${base}/redirect-to?to=${encodeURIComponent(target)}`, 'grant-cdn.bin');
  await expect(
    card.getByRole('button', { name: 'Grant website access for grant-cdn.bin' }),
  ).toBeVisible();
  await expect(card).not.toContainText('destination could not be read');
});
test('a redirect still resolves after background termination without snapshot polling waking it first', async () => {
  const cdp = await context.browser()!.newBrowserCDPSession();
  const targets = await cdp.send('Target.getTargets');
  const background = targets.targetInfos.find(
    (t) => t.type === 'service_worker' && t.url === `chrome-extension://${id}/background.js`,
  );
  expect(background).toBeTruthy();
  await cdp.send('Target.closeTarget', { targetId: background!.targetId });
  const card = await add(`${base}/redirect?case=cold&size=1048576`, 'cold-redirect.bin');
  await expect(card.getByText('Ready to save', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'cold-redirect.bin', exact: true }).click();
  await expect(page.getByLabel('SHA-256 checksum')).toHaveValue(fixtureHash(1048576));
  await cdp.detach();
});
