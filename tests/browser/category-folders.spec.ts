import {
  test,
  expect,
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture } from '../fixtures/server';
import type { Snapshot } from '../../src/domain/model';
let fixture: Awaited<ReturnType<typeof startFixture>>,
  context: BrowserContext,
  root: string,
  id: string,
  manager: Page,
  chromeProcess: ChildProcess | undefined,
  base: string;
const jobs = async () =>
  ((await manager.evaluate(() => chrome.runtime.sendMessage({ type: 'snapshot' }))) as Snapshot)
    .jobs;
async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory())
      out.push(...(await files(path)).map((child) => `${name}/${child}`));
    else out.push(name);
  }
  return out;
}
test.beforeAll(async () => {
  fixture = await startFixture();
  base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
  root = await mkdtemp(join(tmpdir(), 'flux-categories-'));
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
  // Launch Chrome directly: Playwright-launched browsers rename every download to a GUID,
  // which would hide the category path Flux chooses.
  const executablePath = process.env.CHROME_PATH;
  test.skip(!executablePath, 'Set CHROME_PATH to an installed Chrome to run this spec.');
  const port = 9300 + Math.floor(Math.random() * 500);
  chromeProcess = spawn(executablePath!, [
    '--headless=new',
    `--user-data-dir=${join(root, 'profile')}`,
    `--remote-debugging-port=${port}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-proxy-server',
    '--host-resolver-rules=MAP downloads.example.com 127.0.0.1',
    '--disable-features=LocalNetworkAccessChecks',
    'about:blank',
  ]);
  let browser: Browser | undefined;
  for (let attempt = 0; attempt < 50 && !browser; attempt++)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(async () => {
      await new Promise((done) => setTimeout(done, 200));
      return undefined;
    });
  context = browser!.contexts()[0]!;
  const cdp = await browser!.newBrowserCDPSession();
  id = (await cdp.send('Extensions.loadUnpacked', { path: extension })).id;
  // connectOverCDP redirects downloads into Playwright artifacts; restore Chrome's own handling.
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  await cdp.detach();
  manager = await context.newPage();
  await manager.goto(`chrome-extension://${id}/manager.html`);
  await expect(manager.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
});
test.afterAll(async () => {
  await context
    ?.browser()
    ?.close()
    .catch(() => undefined);
  if (chromeProcess && chromeProcess.exitCode === null) {
    const exited = new Promise((done) => chromeProcess!.once('exit', done));
    chromeProcess.kill();
    await exited;
  }
  await fixture?.close();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
test('finished Flux downloads are saved into a category folder inside Downloads automatically', async () => {
  const url = `${base}/range?size=1048576`;
  await manager.getByRole('button', { name: 'Add download', exact: true }).click();
  await manager.getByLabel('Download URL').fill(url);
  await manager
    .getByRole('dialog')
    .getByRole('button', { name: 'Start Download', exact: true })
    .click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === url)?.state, { timeout: 45000 })
    .toBe('COMPLETED');
  const job = (await jobs()).find((item) => item.url === url)!;
  expect(job.exported).toBe(true);
  expect(job.savedDownloadId).toEqual(expect.any(Number));
  const target = await manager.evaluate(
    async (downloadId) => (await chrome.downloads.search({ id: downloadId }))[0],
    job.savedDownloadId!,
  );
  expect(target?.state).toBe('complete');
  expect(target!.filename.split(/[\\/]/).slice(-2)).toEqual(['General', job.filename]);
  await expect(manager.getByText('Automatic saving is on')).toBeVisible();
  // The Save button writes into the same category folder without opening a dialog.
  await manager.getByText(job.filename).first().click();
  await manager.getByRole('button', { name: 'Save again', exact: true }).click();
  await expect
    .poll(async () => (await jobs()).find((item) => item.id === job.id)?.savedDownloadId)
    .not.toBe(job.savedDownloadId);
  const again = (await jobs()).find((item) => item.id === job.id)!;
  expect(again.state).toBe('COMPLETED');
  const copy = await manager.evaluate(
    async (downloadId) => (await chrome.downloads.search({ id: downloadId }))[0],
    again.savedDownloadId!,
  );
  expect(copy!.filename.split(/[\\/]/).slice(-2)[0]).toBe('General');
  await manager.getByRole('button', { name: 'Close dialog', exact: true }).click();
});
test('downloads Chrome keeps are routed into the same category folders', async () => {
  const url = `${base}/range?size=4096&native=1`;
  const site = await context.newPage();
  await site.goto(`${base}/capture-page`);
  await site.evaluate((href) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    document.body.append(anchor);
    anchor.click();
  }, url);
  await expect
    .poll(
      async () =>
        await manager.evaluate(async (href) => {
          const item = (await chrome.downloads.search({ url: href }))[0];
          // Headless Chrome may hold the final rename; the chosen target path is what matters.
          return item?.filename ? item.filename.split(/[\\/]/).slice(-2)[0] : null;
        }, url),
      { timeout: 30000 },
    )
    .toBe('General');
  await site.close();
});
test('Downloads-folder saving refuses staged corruption before starting a new native write', async () => {
  const job = (await jobs()).find((item) => item.exported && item.engine !== 'browser')!;
  const before = await manager.evaluate(() => chrome.downloads.search({}));
  await manager.evaluate(async (id) => {
    const partials = await (await navigator.storage.getDirectory()).getDirectoryHandle('partials');
    const handle = await partials.getFileHandle(id);
    const writer = await handle.createWritable({ keepExistingData: true });
    await writer.write({ type: 'write', position: 0, data: new Uint8Array([255]) });
    await writer.close();
  }, job.id);
  await manager.getByRole('button', { name: job.filename, exact: true }).click();
  await manager.getByRole('button', { name: 'Save again', exact: true }).click();
  await expect(manager.getByRole('dialog').getByRole('alert')).toContainText('SHA-256');
  expect(
    (await manager.evaluate(() => chrome.downloads.search({}))).map((item) => item.id),
  ).toEqual(before.map((item) => item.id));
  expect((await jobs()).find((item) => item.id === job.id)?.state).toBe('ASSEMBLING');
});
