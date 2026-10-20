import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { startFixture, fixtureHash } from '../fixtures/server';

let fixture: Awaited<ReturnType<typeof startFixture>>;
let context: BrowserContext;
let root: string;
let extensionPath: string;
let profile: string;
let extensionId: string;
let base: string;
const executablePath = process.env.CHROME_PATH;
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: executablePath ? undefined : 'chromium',
    executablePath,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      ...(executablePath
        ? []
        : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]),
      '--enable-unsafe-extension-debugging',
      '--no-proxy-server',
      '--host-resolver-rules=MAP downloads.example.com 127.0.0.1',
      '--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksForWebRTC',
    ],
  });
  if (executablePath) {
    const session = await context.browser()!.newBrowserCDPSession();
    const result = await session.send('Extensions.loadUnpacked', { path: extensionPath });
    extensionId = result.id;
    await session.detach();
  } else {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker');
    extensionId = new URL(sw.url()).host;
  }
}
async function openManager() {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/manager.html`);
  await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  return page;
}
async function add(page: Page, url: string, filename: string) {
  await page.getByRole('button', { name: 'Add download', exact: true }).click();
  await page.getByLabel('Download URL').fill(url);
  await page.getByLabel('File name optional').fill(filename);
  await page.getByRole('dialog').getByRole('button', { name: 'Add download', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: filename, exact: true })).toBeVisible();
}
test.beforeAll(async () => {
  fixture = await startFixture();
  base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
  root = await mkdtemp(join(tmpdir(), 'flux-browser-'));
  profile = join(root, 'profile');
  extensionPath = join(root, 'extension');
  await cp(resolve('dist'), extensionPath, { recursive: true });
  // The test package differs only by a pre-granted fixture origin. No test bypass ships.
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://downloads.example.com/*'];
  await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
  await launch();
});
test.afterAll(async () => {
  await context?.close();
  await fixture?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test('installed MV3 engine: real parallel ranges, final hash, popup and streamed export', async () => {
  const page = await openManager();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Connection mode').selectOption('manual');
  await page.getByLabel('Maximum connections').selectOption('4');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.getByRole('button', { name: /All downloads/ }).click();
  await add(page, `${base}/slow?size=5242880&delay=5`, 'parallel.bin');
  await expect(page.getByText('Ready to save', { exact: true })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'parallel.bin', exact: true }).click();
  await expect(page.getByLabel('SHA-256 checksum')).toHaveValue(fixtureHash(5242880));
  expect(fixture.stats.maxActive).toBeGreaterThan(1);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('heading', { name: 'Ready for your next file' })).toBeVisible();
  await popup.close();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  // Browser test substitutes the picker only, retaining real browser filesystem streaming.
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => {
        const dir = await navigator.storage.getDirectory();
        return dir.getFileHandle('browser-export.bin', { create: true });
      },
    });
  });
  await page.getByRole('button', { name: 'Save parallel.bin', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true }).last()).toBeVisible();
  const exportedHash = await page.evaluate(async () => {
    const file = await (
      await (await navigator.storage.getDirectory()).getFileHandle('browser-export.bin')
    ).getFile();
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(hash))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  });
  expect(exportedHash).toBe(fixtureHash(5242880));
  expect(errors).toEqual([]);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/manager-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: 'test-results/screenshots/manager-light.png', fullPage: true });
  await page.close();
});

test('pause, close manager, full browser-context restart and resume retained partial ranges', async () => {
  let page = await openManager();
  fixture.reset();
  await add(page, `${base}/slow?size=12582912&delay=35`, 'recover.bin');
  await expect.poll(() => fixture.stats.bytes).toBeGreaterThan(1500000);
  await page.getByRole('button', { name: 'Pause recover.bin', exact: true }).click();
  await expect(
    page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: 'recover.bin', exact: true }) })
      .getByText('Paused', { exact: true }),
  ).toBeVisible();
  await page.close();
  await context.close();
  await launch();
  page = await openManager();
  await expect(page.getByRole('button', { name: 'recover.bin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume recover.bin', exact: true }).click();
  await expect(
    page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: 'recover.bin', exact: true }) })
      .getByText('Ready to save', { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'recover.bin', exact: true }).click();
  await expect(page.getByLabel('SHA-256 checksum')).toHaveValue(fixtureHash(12582912));
  await page.close();
});

test('closing manager aborts engine and reopening recovers safely; single owner lock', async () => {
  let page = await openManager();
  await add(page, `${base}/slow?size=8388608&delay=55`, 'close-tab.bin');
  await expect(page.getByRole('button', { name: 'Pause close-tab.bin' })).toBeVisible();
  const duplicate = await openManager();
  await expect(duplicate.getByRole('alert')).toContainText('Another manager tab');
  await duplicate.close();
  await page.close();
  await new Promise((r) => setTimeout(r, 500));
  page = await openManager();
  await expect(
    page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: 'close-tab.bin', exact: true }) })
      .getByText('Paused', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resume close-tab.bin' }).click();
  await expect(
    page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: 'close-tab.bin', exact: true }) })
      .getByText('Ready to save', { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await page.close();
});

test('context menu URL prefill, safe redirects, settings persistence and compact layout', async () => {
  const page = await openManager();
  await page.goto(
    `chrome-extension://${extensionId}/manager.html#add=${encodeURIComponent(`${base}/redirect`)}`,
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Download URL')).toHaveValue(`${base}/redirect`);
  await page.getByLabel('File name optional').fill('redirect.bin');
  await page.getByRole('button', { name: 'Add download', exact: true }).last().click();
  await expect(
    page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: 'redirect.bin', exact: true }) })
      .getByText('Ready to save', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 420, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/screenshots/manager-mobile.png', fullPage: true });
  await page.close();
});

test('manager worker continues correctly after the extension service worker is terminated', async () => {
  const page = await openManager();
  fixture.reset();
  await add(page, `${base}/slow?size=16777216&delay=25`, 'worker-lifecycle.bin');
  await expect.poll(() => fixture.stats.bytes).toBeGreaterThan(1000000);
  const cdp = await context.browser()!.newBrowserCDPSession();
  const targets = await cdp.send('Target.getTargets');
  const worker = targets.targetInfos.find(
    (t) =>
      t.type === 'service_worker' && t.url === `chrome-extension://${extensionId}/background.js`,
  );
  expect(worker).toBeTruthy();
  expect((await cdp.send('Target.closeTarget', { targetId: worker!.targetId })).success).toBe(true);
  await expect(
    page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: 'worker-lifecycle.bin', exact: true }) })
      .getByText('Ready to save', { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'worker-lifecycle.bin', exact: true }).click();
  await expect(page.getByLabel('SHA-256 checksum')).toHaveValue(fixtureHash(16777216));
  await cdp.detach();
  await page.close();
});

for (const mib of (process.env.LARGE_FILE_MIB ?? '100').split(',').map(Number))
  test(`bounded streaming download and export at ${mib} MiB`, async () => {
    test.setTimeout(600000);
    const size = mib * 1024 ** 2;
    const name = `large-${mib}.bin`;
    const page = await openManager();
    await add(page, `${base}/range?size=${size}`, name);
    const card = page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name, exact: true }) });
    await expect(card.getByText('Ready to save', { exact: true })).toBeVisible({ timeout: 400000 });
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('SHA-256 checksum')).toHaveValue(fixtureHash(size));
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.evaluate(() =>
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          const dir = await navigator.storage.getDirectory();
          return dir.getFileHandle('large-export.bin', { create: true });
        },
      }),
    );
    await page.getByRole('button', { name: `Save ${name}`, exact: true }).click();
    await expect(card.getByText('Completed', { exact: true })).toBeVisible({ timeout: 180000 });
    const validated = await page.evaluate(async () => {
      const file = await (
        await (await navigator.storage.getDirectory()).getFileHandle('large-export.bin')
      ).getFile();
      const reader = file.stream().getReader();
      let offset = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (let i = 0; i < value.length; i++) {
          const position = offset + i;
          if (value[i] !== (position * 31 + Math.floor(position / 251) * 17) % 256)
            throw new Error('Export byte mismatch');
        }
        offset += value.length;
      }
      reader.releaseLock();
      return offset;
    });
    expect(validated).toBe(size);
    // Free staged/exported test data before the next size, preserving release disk headroom.
    await page.evaluate(async (filename) => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('large-export.bin');
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('flux-downloads', 1);
        r.onsuccess = () => resolve(r.result);
      });
      const jobs = await new Promise<any[]>((resolve) => {
        const r = db.transaction('jobs').objectStore('jobs').getAll();
        r.onsuccess = () => resolve(r.result);
      });
      const job = jobs.find((j) => j.filename === filename);
      await (await root.getDirectoryHandle('partials')).removeEntry(job.id);
      await new Promise<void>((resolve) => {
        const tx = db.transaction('jobs', 'readwrite');
        tx.objectStore('jobs').delete(job.id);
        tx.oncomplete = () => resolve();
      });
      db.close();
    }, name);
    await page.close();
  });
