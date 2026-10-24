import {
  test,
  expect,
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
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
test.beforeAll(async () => {
  fixture = await startFixture();
  base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
  root = await mkdtemp(join(tmpdir(), 'flux-save-dialog-'));
  await mkdir(join(root, 'profile', 'Default'), { recursive: true });
  await mkdir(join(root, 'downloads'), { recursive: true });
  await writeFile(
    join(root, 'profile', 'Default', 'Preferences'),
    JSON.stringify({
      download: { default_directory: join(root, 'downloads'), prompt_for_download: true },
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
test('when the browser asks where to save, the main page warns and offers the fix', async () => {
  const url = `${base}/range?size=65536`;
  await manager.getByRole('button', { name: 'Add download', exact: true }).click();
  await manager.getByLabel('Download URL').fill(url);
  await manager
    .getByRole('dialog')
    .getByRole('button', { name: 'Start Download', exact: true })
    .click();
  await expect(manager.getByText('Your browser asks where to save each file')).toBeVisible({
    timeout: 45000,
  });
  await expect(manager.getByRole('button', { name: 'Open download settings' })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Choose a folder' })).toBeVisible();
});
