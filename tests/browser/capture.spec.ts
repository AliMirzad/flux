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
  // These tests cover automatic starts; the Add Download window has its own test below.
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.locator('input[name="confirmCapture"]').uncheck();
  await manager.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await manager.getByRole('button', { name: /All downloads/ }).click();
  site = await context.newPage();
  await site.goto(`${base}/capture-page`);
  await site.evaluate((url) => {
    const frame = document.createElement('iframe');
    frame.id = 'existing-download-frame';
    frame.src = url;
    document.body.append(frame);
  }, `${base}/capture-page?existing-frame=1`);
  await expect(site.frameLocator('#existing-download-frame').locator('#normal')).toBeVisible();
});
test.afterAll(async () => {
  await context?.close();
  await fixture?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
test('one-time enable immediately captures normal, download-attribute and cross-origin links in existing tabs without native duplicates', async () => {
  await manager.getByRole('button', { name: 'Enable automatic downloads', exact: true }).click();
  await manager.evaluate(() => chrome.runtime.sendMessage({ type: 'configure-offers' }));
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByRole('button', { name: 'Check download integration', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText(
    'Automatic capture: on. Website access: granted. Link listener: registered.',
  );
  await manager.getByRole('button', { name: 'Reconnect link capture', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText('Background: responding.');
  await manager.getByRole('button', { name: /All downloads/ }).click();
  const frame = site.frameLocator('#existing-download-frame');
  const framedUrl = `${base}/already-open-frame.zip?size=1048576&delay=2`;
  await frame
    .locator('#normal')
    .evaluate((anchor, target) => ((anchor as HTMLAnchorElement).href = target), framedUrl);
  await frame.locator('#normal').click();
  await waitReady(framedUrl, 1048576);
  expect((await browserItems()).filter((item) => item.url === framedUrl)).toHaveLength(0);
  for (const selector of ['#normal', '#download-attribute', '#cross-origin']) {
    const url = await site.locator(selector).getAttribute('href');
    const absolute = new URL(url!, base).href;
    await site.locator(selector).click();
    await waitReady(absolute, 1048576);
    expect((await browserItems()).filter((item) => item.url === absolute)).toHaveLength(0);
  }
  const url = new URL((await site.locator('#normal').getAttribute('href'))!, base).href;
  await site.locator('#normal').click();
  await manager.evaluate(() => chrome.runtime.sendMessage({ type: 'configure-offers' }));
  expect((await jobs()).filter((job) => job.url === url)).toHaveLength(1);
  expect((await browserItems()).filter((item) => item.url === url)).toHaveLength(0);
});
test('captured redirect and cross-host redirect download successfully while private redirect targets never get fetched', async () => {
  const url = new URL((await site.locator('#redirect').getAttribute('href'))!, base).href;
  await site.locator('#redirect').click();
  await waitReady(url, 1048576);
  const target = `${base.replace('downloads.example.com', 'cdn.example.com')}/range?size=1048576`;
  const redirected = `${base}/redirect-to?to=${encodeURIComponent(target)}`;
  await manager.getByRole('button', { name: 'Add download', exact: true }).click();
  await manager.getByLabel('Download URL').fill(redirected);
  await manager
    .getByRole('dialog')
    .getByRole('button', { name: 'Start Download', exact: true })
    .click();
  await waitReady(redirected, 1048576);
  const blocked = `${base}/redirect-private`;
  await manager.getByRole('button', { name: 'Add download', exact: true }).click();
  await manager.getByLabel('Download URL').fill(blocked);
  await manager
    .getByRole('dialog')
    .getByRole('button', { name: 'Start Download', exact: true })
    .click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === blocked)?.state)
    .toBe('FAILED');
  expect((await jobs()).find((job) => job.url === blocked)?.error).toContain('private');
  expect(fixture.stats.paths).not.toContain('/private');
});
test('file links inside a newly created frame are captured before Chrome starts a duplicate', async () => {
  await site.evaluate((url) => {
    const frame = document.createElement('iframe');
    frame.id = 'download-frame';
    frame.src = url;
    document.body.append(frame);
  }, `${base}/capture-page?frame=1`);
  const frame = site.frameLocator('#download-frame');
  await expect(frame.locator('#normal')).toBeVisible();
  const url = `${base}/framed.zip?size=1048576&delay=2`;
  await frame
    .locator('#normal')
    .evaluate((anchor, target) => ((anchor as HTMLAnchorElement).href = target), url);
  await frame.locator('#normal').click();
  await waitReady(url, 1048576);
  expect((await browserItems()).filter((item) => item.url === url)).toHaveLength(0);
});
test('new-tab links whose address is swapped in on press follow multi-host redirects in Flux', async () => {
  // Mirrors mirror sites such as soft98: a placeholder page href becomes the CDN file on mousedown,
  // and the CDN hops across hosts before serving ranges.
  const cdn = base.replace('downloads.example.com', 'cdn.example.com');
  const file = `${base}/range?size=1048576`;
  const url = `${base}/redirect-to?filename=mirror.zip&to=${encodeURIComponent(
    `${cdn}/redirect-to?to=${encodeURIComponent(file)}`,
  )}`;
  await site.evaluate(
    ({ placeholder, target }) => {
      const link = document.createElement('a');
      link.id = 'swapped';
      link.target = '_blank';
      link.rel = 'nofollow';
      link.href = placeholder;
      link.textContent = 'Mirror download';
      link.addEventListener('mousedown', () => (link.href = target));
      document.body.append(link);
    },
    { placeholder: `${base}/capture-page?mirror=1`, target: url },
  );
  const pages = context.pages().length;
  await site.locator('#swapped').click();
  await waitReady(url, 1048576);
  expect((await browserItems()).filter((item) => item.url === url)).toHaveLength(0);
  expect(context.pages()).toHaveLength(pages);
});

test('ordinary generated public GET downloads transfer ownership to Flux and cancel Chrome only after durable queueing', async () => {
  const url = `${base}/attachment?size=2097152&delay=30`;
  await site.locator('#native').click();
  const job = await waitReady(url, 2097152);
  expect(job.capturePending).toBe(false);
  // The existing takeover handler erases Chrome's canceled record after Flux owns the file.
  await expect
    .poll(async () => (await browserItems()).find((item) => item.url === url)?.state)
    .toBeUndefined();
  expect((await jobs()).filter((job) => job.url === url)).toHaveLength(1);
});
test('cookie-authenticated downloads are taken over by Flux with the browser session', async () => {
  const cookieLink = new URL((await site.locator('#cookie-link').getAttribute('href'))!, base).href;
  await site.locator('#cookie-link').click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === cookieLink)?.state, {
      timeout: 30000,
    })
    .toBe('COMPLETED');
  const job = (await jobs()).find((item) => item.url === cookieLink)!;
  expect(job.engine).not.toBe('browser');
  expect(job.sha256).toBe(fixtureHash(1048576));
});
test('the cookie choice is real and redirected CDN requests omit an unrelated session', async () => {
  const direct = `${base}/cookie-file?size=131072&omit=1`;
  await manager.getByRole('button', { name: 'Add download', exact: true }).click();
  await manager.getByLabel('Download URL').fill(direct);
  await manager.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await manager.getByLabel('Use browser cookies', { exact: true }).uncheck();
  await manager.getByRole('button', { name: 'Start Download', exact: true }).click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === direct)?.state)
    .toBe('FAILED');
  expect((await jobs()).find((job) => job.url === direct)?.error).toContain('401');
  const cdn = base.replace('downloads.example.com', 'cdn.example.com');
  await context.addCookies([{ name: 'cdn_session', value: 'fixture', url: cdn }]);
  const target = `${cdn}/session-isolation.zip?size=131072`;
  const redirected = `${base}/redirect-to?to=${encodeURIComponent(target)}`;
  await manager.getByRole('button', { name: 'Add download', exact: true }).click();
  await manager.getByLabel('Download URL').fill(redirected);
  await manager.getByRole('button', { name: 'Start Download', exact: true }).click();
  await waitReady(redirected, 131072);
  const requests = fixture.stats.cookieRequests.filter(
    (entry) => entry.path === '/session-isolation.zip',
  );
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((entry) => entry.host === 'cdn.example.com' && !entry.present)).toBe(true);
});

test('POST and referrer-bound downloads preserve the original browser transfer instead of failing or losing data', async () => {
  await site.locator('#authenticated-link').click();
  const cookieLink = new URL(
    (await site.locator('#authenticated-link').getAttribute('href'))!,
    base,
  ).href;
  await expect
    .poll(async () => (await browserItems()).find((item) => item.url === cookieLink)?.state, {
      timeout: 30000,
    })
    .toBe('complete');
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === cookieLink)?.state)
    .toBe('COMPLETED');
  const cookieJob = (await jobs()).find((job) => job.url === cookieLink)!;
  expect(cookieJob.engine).toBe('browser');
  expect(cookieJob.sha256).toBeNull();
  expect(cookieJob.browser?.id).toBe(
    (await browserItems()).find((item) => item.url === cookieLink)?.id,
  );
  await site.locator('#post').click();
  const post = `${base}/post-file?size=131072`;
  await expect
    .poll(async () => (await browserItems()).find((item) => item.url === post)?.state, {
      timeout: 30000,
    })
    .toBe('complete');
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === post)?.state)
    .toBe('COMPLETED');
  expect((await jobs()).find((job) => job.url === post)?.engine).toBe('browser');
  await site.locator('#authenticated').click();
  const auth = `${base}/auth-browser?size=2097152&delay=30`;
  await expect
    .poll(async () => (await browserItems()).find((item) => item.url === auth)?.state, {
      timeout: 45000,
    })
    .toBe('complete');
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === auth)?.state)
    .toBe('COMPLETED');
  expect((await jobs()).find((job) => job.url === auth)?.engine).toBe('browser');
});

test('original authenticated transfers pause, survive manager closure, resume from popup and finish without replay', async () => {
  const url = `${base}/auth-browser?size=8388608&delay=35&native-controls=1`;
  await site.evaluate((target) => {
    const button = document.createElement('button');
    button.id = 'native-controls';
    button.textContent = 'Native controls';
    button.onclick = () => {
      location.href = target;
    };
    document.body.append(button);
  }, url);
  await site.locator('#native-controls').click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === url)?.engine)
    .toBe('browser');
  const job = (await jobs()).find((job) => job.url === url)!;
  await manager.getByRole('button', { name: `Pause ${job.filename}`, exact: true }).click();
  await expect
    .poll(async () => (await browserItems()).find((item) => item.id === job.browser!.id)?.paused)
    .toBe(true);
  await manager.close();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(
    popup.getByRole('button', { name: `Resume ${job.filename}`, exact: true }),
  ).toBeVisible();
  expect(
    (await popup.evaluate((id) => chrome.downloads.search({ id }), job.browser!.id))[0]?.paused,
  ).toBe(true);
  await popup.getByRole('button', { name: `Resume ${job.filename}`, exact: true }).click();
  await expect
    .poll(
      async () =>
        (await popup.evaluate((id) => chrome.downloads.search({ id }), job.browser!.id))[0]?.state,
    )
    .toBe('complete');
  const native = (
    await popup.evaluate((id) => chrome.downloads.search({ id }), job.browser!.id)
  )[0]!;
  expect(native.filename.startsWith(join(root, 'downloads'))).toBe(true);
  expect(
    createHash('sha256')
      .update(await readFile(native.filename))
      .digest('hex'),
  ).toBe(fixtureHash(8388608));
  manager = await context.newPage();
  await manager.goto(`chrome-extension://${id}/manager.html`);
  await expect
    .poll(async () => (await jobs()).find((item) => item.id === job.id)?.state)
    .toBe('COMPLETED');
  const finished = (await jobs()).find((item) => item.id === job.id)!;
  expect(finished.sha256).toBeNull();
  expect(finished.browser?.id).toBe(job.browser!.id);
  expect((await browserItems()).filter((item) => item.url === url)).toHaveLength(1);
  await popup.close();
});

test('canceling a linked transfer cancels the original browser request without creating a replacement', async () => {
  const url = `${base}/auth-browser?size=8388608&delay=70&native-cancel=1`;
  await site.evaluate((target) => {
    const button = document.createElement('button');
    button.id = 'native-cancel';
    button.textContent = 'Cancel original';
    button.onclick = () => {
      location.href = target;
    };
    document.body.append(button);
  }, url);
  await site.locator('#native-cancel').click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === url)?.engine)
    .toBe('browser');
  const job = (await jobs()).find((item) => item.url === url)!;
  await manager.locator(`[data-job-id="${job.id}"]`).getByRole('checkbox').check();
  manager.once('dialog', (dialog) => dialog.accept());
  await manager.getByRole('button', { name: 'Cancel selected', exact: true }).click();
  await expect
    .poll(async () => (await jobs()).find((item) => item.id === job.id)?.state)
    .toBe('CANCELED');
  const originals = (await browserItems()).filter((item) => item.url === url);
  expect(originals).toHaveLength(1);
  expect(originals[0]!.id).toBe(job.browser!.id);
  expect(originals[0]!.error).toBe('USER_CANCELED');
});
test('named queues, batch link review and expired address refresh control real engine transfers', async () => {
  await manager.getByRole('button', { name: 'Manage queues', exact: true }).click();
  await manager.getByRole('button', { name: 'New queue', exact: true }).click();
  await manager.getByLabel('Queue name').fill('Sequential files');
  await manager.getByRole('button', { name: 'Save queue', exact: true }).click();
  await expect(
    manager.getByRole('dialog').getByText('Sequential files', { exact: true }),
  ).toBeVisible();
  // An unscheduled queue runs as soon as it is created; stop it to hold the batch.
  await manager.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Start now', exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await manager.getByRole('button', { name: 'Add multiple links', exact: true }).click();
  const inputs = [1, 2, 3].map((number) => ({
    url: `${base}/range?size=1048576&delay=2&batch=${number}`,
    filename: `batch-${number}.bin`,
  }));
  await manager
    .getByLabel('Download links', { exact: true })
    .fill(inputs.map((item) => `${item.url}\t${item.filename}`).join('\n'));
  await manager.getByLabel('Download queue').selectOption({ label: 'Sequential files' });
  await manager.getByRole('button', { name: 'Add selected downloads', exact: true }).click();
  await expect(manager.getByRole('status')).toHaveText('3 added; 0 already queued.');
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  expect(
    (await jobs())
      .filter((job) => inputs.some((input) => input.url === job.url))
      .every((job) => job.state === 'QUEUED'),
  ).toBe(true);
  await manager.getByRole('button', { name: 'Manage queues', exact: true }).click();
  await manager.getByRole('button', { name: 'Start now', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  for (const input of inputs) await waitReady(input.url, 1048576);
  await manager.getByRole('button', { name: 'Add download', exact: true }).click();
  const expired = `${base}/expiring?size=1048576&expires=0`;
  await manager.getByLabel('Download URL').fill(expired);
  await manager.getByLabel('File name optional').fill('refreshed.bin');
  await manager
    .getByRole('dialog')
    .getByRole('button', { name: 'Start Download', exact: true })
    .click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === expired)?.state)
    .toBe('FAILED');
  const original = (await jobs()).find((job) => job.url === expired)!;
  await manager.getByRole('button', { name: 'Details for refreshed.bin', exact: true }).click();
  const fresh = `${base}/range?size=1048576&fresh=1`;
  await manager.getByLabel('Source URL', { exact: true }).fill(fresh);
  await manager.getByRole('button', { name: 'Refresh download address', exact: true }).click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.id === original.id)?.url)
    .toBe(fresh);
  await manager.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await manager.getByRole('button', { name: 'Resume refreshed.bin', exact: true }).click();
  const resumed = await waitReady(fresh, 1048576);
  expect(resumed.id).toBe(original.id);
});

test('page link discovery, clipboard/drop review, selected actions and exported lists use real jobs', async () => {
  const grabbed = `${base}/grabbed.zip?size=131072`;
  await site.evaluate((url) => {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'Grabbed file';
    document.body.append(link);
    const privateLink = document.createElement('a');
    privateLink.href = 'http://127.0.0.1/private.zip';
    document.body.append(privateLink);
  }, grabbed);
  await manager.getByRole('button', { name: 'Grab page links', exact: true }).click();
  await expect(manager.getByLabel('Download links', { exact: true })).toContainText('grabbed.zip');
  await expect(manager.getByLabel('Download links', { exact: true })).not.toContainText(
    '127.0.0.1',
  );
  await manager.getByLabel('Filter links', { exact: true }).fill('grabbed.zip');
  await manager.getByLabel('Add paused', { exact: true }).check();
  await manager.getByRole('button', { name: 'Add selected downloads', exact: true }).click();
  await expect(manager.getByRole('status')).toHaveText('1 added; 0 already queued.');
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await manager.getByRole('checkbox', { name: 'Select grabbed.zip', exact: true }).check();
  await manager.getByRole('button', { name: 'Resume selected', exact: true }).click();
  await waitReady(grabbed, 131072);
  const pasted = `${base}/pasted.zip?size=131072`;
  await manager.evaluate((url) => {
    const data = new DataTransfer();
    data.setData('text/plain', url);
    document
      .querySelector('.app-shell')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, pasted);
  await expect(manager.getByLabel('Download links', { exact: true })).toHaveValue(pasted);
  await manager.getByLabel('Add paused', { exact: true }).check();
  await manager.getByRole('button', { name: 'Add selected downloads', exact: true }).click();
  await expect(manager.getByRole('status')).toHaveText('1 added; 0 already queued.');
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await manager.getByRole('checkbox', { name: 'Select pasted.zip', exact: true }).check();
  manager.once('dialog', (dialog) => dialog.accept());
  await manager.getByRole('button', { name: 'Remove selected', exact: true }).click();
  await expect.poll(async () => (await jobs()).some((job) => job.url === pasted)).toBe(false);
  const dropped = `${base}/dropped.zip?size=131072`;
  const data = await manager.evaluateHandle((url) => {
    const value = new DataTransfer();
    value.setData('text/uri-list', url);
    return value;
  }, dropped);
  await manager.locator('.app-shell').dispatchEvent('drop', { dataTransfer: data });
  await expect(manager.getByLabel('Download links', { exact: true })).toHaveValue(dropped);
  await manager.getByLabel('Add paused', { exact: true }).check();
  await manager.getByRole('button', { name: 'Add selected downloads', exact: true }).click();
  await expect(manager.getByRole('status')).toHaveText('1 added; 0 already queued.');
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await manager.getByRole('checkbox', { name: 'Select dropped.zip', exact: true }).check();
  manager.once('dialog', (dialog) => dialog.accept());
  await manager.getByRole('button', { name: 'Cancel selected', exact: true }).click();
  await expect
    .poll(async () => (await jobs()).find((job) => job.url === dropped)?.state)
    .toBe('CANCELED');
  await manager.evaluate(() => {
    (
      window as Window & { showSaveFilePicker?: () => Promise<FileSystemFileHandle> }
    ).showSaveFilePicker = async () =>
      (await navigator.storage.getDirectory()).getFileHandle('exported-list.json', {
        create: true,
      });
  });
  await manager.getByRole('button', { name: 'Export link list', exact: true }).click();
  await expect
    .poll(async () =>
      manager.evaluate(async () => {
        try {
          const file = await (
            await (await navigator.storage.getDirectory()).getFileHandle('exported-list.json')
          ).getFile();
          return JSON.parse(await file.text()).items.length as number;
        } catch {
          return 0;
        }
      }),
    )
    .toBeGreaterThan(0);
});

test('site exclusion preserves a cross-origin generated browser download', async () => {
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByLabel('Excluded hosts').fill('downloads.example.com');
  await manager.getByRole('button', { name: 'Save preferences' }).click();
  await expect(manager.getByText('Preferences saved')).toBeVisible();
  const framed = `${base.replace('downloads.example.com', 'cdn.example.com')}/frame-excluded.zip?size=131072`;
  await site.evaluate(
    (url) => {
      const frame = document.createElement('iframe');
      frame.id = 'excluded-frame';
      frame.src = url;
      document.body.append(frame);
    },
    `${base.replace('downloads.example.com', 'cdn.example.com')}/capture-page`,
  );
  const frame = site.frameLocator('#excluded-frame');
  await expect(frame.locator('#normal')).toBeVisible();
  await frame
    .locator('#normal')
    .evaluate((anchor, url) => ((anchor as HTMLAnchorElement).href = url), framed);
  await frame.locator('#normal').click();
  await expect
    .poll(async () => (await browserItems()).find((item) => item.url === framed)?.state)
    .toBe('complete');
  expect((await jobs()).find((job) => job.url === framed)).toBeUndefined();
  const url = `${base.replace('downloads.example.com', 'cdn.example.com')}/attachment?size=2097152&delay=30&excluded=1`;
  await site.evaluate((target) => {
    const button = document.createElement('button');
    button.id = 'excluded-generated';
    button.textContent = 'Excluded generated download';
    button.onclick = () => {
      location.href = target;
    };
    document.body.append(button);
  }, url);
  await site.locator('#excluded-generated').click();
  await expect
    .poll(async () => (await browserItems()).find((item) => item.url === url)?.state, {
      timeout: 30000,
    })
    .toBe('complete');
  expect((await jobs()).find((job) => job.url === url)).toBeUndefined();
});

test('disabling capture updates already-injected pages and leaves subsequent downloads with Chrome', async () => {
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByLabel('Automatically capture downloads').uncheck();
  await manager.getByRole('button', { name: 'Save preferences' }).click();
  await expect(manager.getByText('Preferences saved')).toBeVisible();
  const url = new URL((await site.locator('#excluded').getAttribute('href'))!, base).href;
  await site.locator('#excluded').click();
  await expect
    .poll(async () => (await browserItems()).find((item) => item.url === url)?.state, {
      timeout: 30000,
    })
    .toBe('complete');
  expect((await jobs()).find((job) => job.url === url)).toBeUndefined();
});

test('a chosen destination automatically exports verified files, avoids existing names and survives manager reload', async () => {
  await manager.getByRole('button', { name: /^All downloads/ }).click();
  await manager.evaluate(async () => {
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('auto-save-test', { create: true });
    // Category folders are on by default; unknown types go to General.
    const general = await directory.getDirectoryHandle('General', { create: true });
    const existing = await general.getFileHandle('same-name.bin', { create: true });
    const stream = await existing.createWritable();
    await stream.write('existing');
    await stream.close();
    (
      window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker = async () => directory;
  });
  await manager.getByRole('button', { name: 'Choose download folder', exact: true }).click();
  await expect(
    manager.getByRole('button', { name: 'Folder: auto-save-test', exact: true }),
  ).toBeVisible();
  for (let index = 1; index <= 3; index++) {
    if (index === 3) await manager.reload();
    await manager.getByRole('button', { name: 'Add download', exact: true }).click();
    const url = `${base}/range?size=1048576&auto=${index}`;
    await manager.getByLabel('Download URL').fill(url);
    await manager.getByLabel('File name optional').fill('same-name.bin');
    await manager
      .getByRole('dialog')
      .getByRole('button', { name: 'Start Download', exact: true })
      .click();
    await expect
      .poll(async () => (await jobs()).find((job) => job.url === url)?.state, { timeout: 30000 })
      .toBe('COMPLETED');
  }
  const result = await manager.evaluate(async () => {
    const directory = await (
      await navigator.storage.getDirectory()
    )
      .getDirectoryHandle('auto-save-test')
      .then((root) => root.getDirectoryHandle('General'));
    const original = await (await directory.getFileHandle('same-name.bin')).getFile();
    const hashes = [];
    for (let number = 1; number <= 3; number++) {
      const file = await (await directory.getFileHandle(`same-name (${number}).bin`)).getFile();
      hashes.push(
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
      );
    }
    return { original: await original.text(), hashes };
  });
  expect(result.original).toBe('existing');
  expect(result.hashes).toEqual(Array(3).fill(fixtureHash(1048576)));
});

test('trusted blob and data download links retain their bytes and filenames without persisting payload URLs', async () => {
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByLabel('Excluded hosts').fill('');
  await manager.getByLabel('Automatically capture downloads').check();
  await manager.getByRole('button', { name: 'Save preferences' }).click();
  await expect(manager.getByText('Preferences saved')).toBeVisible();
  await manager.getByRole('button', { name: /^All downloads/ }).click();
  await manager.getByLabel('Search downloads').fill('');
  await manager.getByLabel('Filter by queue').selectOption('all');
  await manager.getByLabel('Filter by status').selectOption('all');
  const cdp = await context.browser()!.newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  await cdp.detach();
  for (const kind of ['blob', 'data'] as const) {
    const filename = `generated-${kind}.txt`;
    const contents = `Flux generated ${kind} file: \u2713`.repeat(kind === 'blob' ? 20000 : 1);
    await site.evaluate(
      ({ kind, filename, contents }) => {
        const link = document.createElement('a');
        link.id = `generated-${kind}`;
        link.download = filename;
        link.textContent = filename;
        link.href =
          kind === 'blob'
            ? URL.createObjectURL(new Blob([contents], { type: 'text/plain' }))
            : `data:text/plain;charset=utf-8,${encodeURIComponent(contents)}`;
        document.body.append(link);
      },
      { kind, filename, contents },
    );
    await site.locator(`#generated-${kind}`).click();
    await expect
      .poll(async () => (await jobs()).find((job) => job.filename === filename)?.state)
      .toBe('COMPLETED');
    const job = (await jobs()).find((item) => item.filename === filename)!;
    // Flux reads the page's bytes itself, so the job is a verified Flux file, not a Chrome transfer.
    expect(job.engine).not.toBe('browser');
    expect(job.pageFile).toBe(true);
    expect(job.sha256).toBe(createHash('sha256').update(contents).digest('hex'));
    expect(JSON.stringify(job)).not.toContain('data:text/');
    expect(JSON.stringify(job)).not.toContain(encodeURIComponent(contents));
    // Category folders are on by default; .txt files go to Documents. An earlier test may have
    // chosen a destination folder, in which case Flux writes there instead of Chrome's Downloads.
    const saved = join(root, 'downloads', 'Documents', filename);
    const inFolder = await manager.evaluate(async (name) => {
      try {
        const directory = await (
          await navigator.storage.getDirectory()
        )
          .getDirectoryHandle('auto-save-test')
          .then((folder) => folder.getDirectoryHandle('Documents'));
        return await (await (await directory.getFileHandle(name)).getFile()).text();
      } catch {
        return null;
      }
    }, filename);
    expect(inFolder ?? (await readFile(saved, 'utf8'))).toBe(contents);
    await manager.getByRole('button', { name: `Details for ${filename}`, exact: true }).click();
    await expect(manager.getByRole('button', { name: 'Download again', exact: true })).toHaveCount(
      0,
    );
    await expect(manager.getByLabel('Source URL', { exact: true })).toHaveAttribute('readonly', '');
    await manager.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await manager.locator(`[data-job-id="${job.id}"]`).getByRole('checkbox').check();
    manager.once('dialog', (dialog) => dialog.accept());
    await manager.getByRole('button', { name: 'Remove selected', exact: true }).click();
    await expect.poll(async () => (await jobs()).some((item) => item.id === job.id)).toBe(false);
  }
});

test('script-triggered blob downloads that Chrome already started are taken over by Flux', async () => {
  const filename = 'scripted-blob.txt';
  const contents = 'Flux scripted blob ✓';
  await site.evaluate(
    ({ filename, contents }) => {
      // A detached anchor clicked from script never reaches the page-level click hook.
      const link = document.createElement('a');
      link.download = filename;
      link.href = URL.createObjectURL(new Blob([contents], { type: 'text/plain' }));
      setTimeout(() => link.click(), 0);
    },
    { filename, contents },
  );
  await expect
    .poll(async () => (await jobs()).find((job) => job.filename === filename)?.state, {
      timeout: 30000,
    })
    .toBe('COMPLETED');
  const job = (await jobs()).find((item) => item.filename === filename)!;
  expect(job.engine).not.toBe('browser');
  expect(job.sha256).toBe(createHash('sha256').update(contents).digest('hex'));
  // The verified job can complete before the background finishes removing Chrome's copy.
  await expect
    .poll(
      async () =>
        (await browserItems()).filter(
          (item) =>
            item.url.startsWith('blob:') &&
            item.filename.endsWith(filename) &&
            item.state === 'complete' &&
            item.exists,
        ).length,
    )
    .toBe(0);
});

test('excluded parent pages keep generated frame downloads outside Flux', async () => {
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByLabel('Excluded hosts').fill('downloads.example.com');
  await manager.getByLabel('Automatically capture downloads').check();
  await manager.getByRole('button', { name: 'Save preferences' }).click();
  await expect(manager.getByText('Preferences saved')).toBeVisible();
  await site.evaluate(
    (source) => {
      document.querySelector('#generated-excluded-frame')?.remove();
      const frame = document.createElement('iframe');
      frame.id = 'generated-excluded-frame';
      frame.src = source;
      document.body.append(frame);
    },
    `${base.replace('downloads.example.com', 'cdn.example.com')}/capture-page`,
  );
  const frame = site.frameLocator('#generated-excluded-frame');
  const generated = await frame.locator('body').evaluate((body) => {
    const link = document.createElement('a');
    link.id = 'excluded-blob';
    link.download = 'excluded-blob.txt';
    link.textContent = 'Excluded generated file';
    link.href = URL.createObjectURL(new Blob(['Excluded parent'], { type: 'text/plain' }));
    body.append(link);
    return link.href;
  });
  await frame.locator('#excluded-blob').click();
  await expect
    .poll(async () => (await browserItems()).find((item) => item.url === generated)?.state)
    .toBe('complete');
  expect((await jobs()).find((job) => job.url === generated)).toBeUndefined();
  const original = (await browserItems()).find((item) => item.url === generated)!;
  // Exclusion keeps the file out of Flux; Chrome still files it into its category folder.
  expect(original.filename).toBe(join(root, 'downloads', 'Documents', 'excluded-blob.txt'));
  expect(await readFile(original.filename, 'utf8')).toBe('Excluded parent');
});
test('a captured link waits for a queue choice in the popup, then downloads in the chosen queue', async () => {
  await manager.bringToFront();
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByLabel('Excluded hosts').fill('');
  await manager.getByRole('button', { name: 'Save preferences' }).click();
  await expect(manager.getByText('Preferences saved')).toBeVisible();
  await manager.getByRole('button', { name: /^All downloads/ }).click();
  await manager.getByRole('button', { name: 'Manage queues', exact: true }).click();
  await manager.getByRole('button', { name: 'New queue', exact: true }).click();
  await manager.getByLabel('Queue name').fill('Chooser test');
  await manager.getByRole('button', { name: 'Save queue', exact: true }).click();
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  const queueId = (await snapshot()).settings.queues.find((q) => q.name === 'Chooser test')!.id;
  const url = `${base}/chooser.zip?size=131072`;
  await site.bringToFront();
  await site.locator('#normal').evaluate((anchor, target) => {
    (anchor as HTMLAnchorElement).href = target;
  }, url);
  await site.locator('#normal').click();
  const pending = () =>
    manager.evaluate(
      async () =>
        (
          (await chrome.storage.session.get('queueChoice')) as {
            queueChoice?: { items: { id: string }[] };
          }
        ).queueChoice?.items ?? [],
    );
  await expect.poll(async () => (await pending()).length).toBe(1);
  expect((await browserItems()).filter((item) => item.url === url)).toHaveLength(0);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.getByText('Where should this download go?')).toBeVisible();
  await popup.getByRole('radio', { name: /Chooser test/ }).check();
  await popup.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect.poll(async () => (await pending()).length).toBe(0);
  const job = await waitReady(url, 131072);
  expect(job.queueId).toBe(queueId);
  await popup.close();
});
test('an invalidated extension context leaves an already-open page download usable in Chrome', async () => {
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByLabel('Excluded hosts').fill('');
  await manager.getByLabel('Automatically capture downloads').check();
  await manager.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(manager.getByText('Preferences saved')).toBeVisible();
  await site.goto(`${base}/capture-page?before-reload=1`);
  const url = `${base}/extension-reloaded.zip?size=1048576&delay=2`;
  await site
    .locator('#normal')
    .evaluate((anchor, href) => ((anchor as HTMLAnchorElement).href = href), url);
  const previous = context
    .serviceWorkers()
    .find((worker) => worker.url() === `chrome-extension://${id}/background.js`)!;
  const cdp = await context.browser()!.newBrowserCDPSession();
  const oldTarget = (await cdp.send('Target.getTargets')).targetInfos.find(
    (target) => target.type === 'service_worker' && target.url === previous.url(),
  )!;
  await previous.evaluate(() => {
    setTimeout(() => chrome.runtime.reload(), 0);
  });
  await expect
    .poll(async () =>
      (await cdp.send('Target.getTargets')).targetInfos.some(
        (target) => target.targetId === oldTarget.targetId,
      ),
    )
    .toBe(false);
  await cdp.detach();
  const download = site.waitForEvent('download', { timeout: 10000 });
  await site.locator('#normal').click();
  const original = await download;
  expect(original.url()).toBe(url);
  await original.cancel();
});
