import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, fixtureHash } from '../fixtures/server';
import type { Snapshot } from '../../src/domain/model';
let context: BrowserContext, page: Page, root: string, id: string, base: string;
let fixture: Awaited<ReturnType<typeof startFixture>>;
test.beforeEach(async () => {
  fixture = await startFixture();
  base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
  root = await mkdtemp(join(tmpdir(), 'flux-advanced-'));
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
      '--host-resolver-rules=MAP downloads.example.com 127.0.0.1',
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
});
test.afterEach(async () => {
  await context?.close();
  await fixture?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function open() {
  await page.goto(`chrome-extension://${id}/manager.html`);
  await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  // These engine/scheduler tests inspect staged data; destination saving has its own specs.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Automatically save finished downloads').uncheck();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await home();
}
const snapshot = () =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'snapshot' })) as Snapshot);
async function home() {
  await page.getByRole('button', { name: /^All downloads/ }).click();
}
async function add(url: string, filename: string, queue?: string) {
  await page.getByRole('button', { name: 'Add download', exact: true }).click();
  await page.getByLabel('Download URL').fill(url);
  await page.getByLabel('File name optional').fill(filename);
  if (queue) {
    await page.getByRole('tab', { name: 'Schedule' }).click();
    await page.getByLabel('Download queue').selectOption({ label: queue });
  }
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Start Download', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('an allowance pause persists complete OPFS ranges and resumes only missing bytes after its limit is raised', async () => {
  await open();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Allowance (MiB, 0 = unlimited)').fill('1');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await home();
  const url = `${base}/range?size=3145728&quota=1`;
  await add(url, 'allowance.bin');
  await expect
    .poll(async () => (await snapshot()).jobs.find((job) => job.url === url)?.state)
    .toBe('PAUSED');
  const first = (await snapshot()).jobs.find((job) => job.url === url)!;
  expect(first.downloaded).toBe(1048576);
  expect(first.segments).toHaveLength(1);
  expect(first.budgetResumeAt).toBeGreaterThan(Date.now());
  const requests = fixture.stats.rangeRequests;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  expect((await snapshot()).jobs.find((job) => job.id === first.id)?.state).toBe('PAUSED');
  expect(fixture.stats.rangeRequests).toBe(requests);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Allowance (MiB, 0 = unlimited)').fill('3');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await home();
  await expect
    .poll(async () => (await snapshot()).jobs.find((job) => job.id === first.id)?.state)
    .toBe('ASSEMBLING');
  expect((await snapshot()).jobs.find((job) => job.id === first.id)?.sha256).toBe(
    fixtureHash(3145728),
  );
  expect(fixture.stats.ranges.filter((range) => range === 'bytes=0-1048575')).toHaveLength(1);
});
test('a weekly queue starts and pauses at its actual window boundaries, then resumes on the next selected day', async () => {
  await page.clock.install({ time: new Date(2026, 9, 19, 21, 59) });
  await open();
  await page.getByRole('button', { name: 'Manage queues', exact: true }).click();
  await page.getByRole('button', { name: 'New queue', exact: true }).click();
  await page.getByLabel('Queue name').fill('Monday window');
  await page.getByLabel('Start on a schedule').check();
  await page.getByLabel('When all files are finished').selectOption('stop');
  for (const day of ['Sun', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    await page.getByLabel(day, { exact: true }).uncheck();
  await page.getByLabel('Queue window start').fill('22:00');
  await page.getByLabel('Queue window end').fill('22:02');
  await page.getByText('Date range', { exact: true }).click();
  await page.getByLabel('Queue first start').fill('2026-10-19T22:00');
  await page.getByRole('button', { name: 'Save queue', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const url = `${base}/slow?size=3145728&delay=50&weekly=1`;
  await add(url, 'weekly.bin', 'Monday window');
  expect((await snapshot()).jobs.find((job) => job.url === url)?.state).toBe('QUEUED');
  await page.clock.fastForward(60000);
  await expect.poll(() => fixture.stats.bytes).toBeGreaterThan(65536);
  await page.clock.fastForward(120000);
  await expect
    .poll(async () => (await snapshot()).jobs.find((job) => job.url === url)?.state)
    .toBe('QUEUED');
  await page.clock.fastForward(7 * 86400000 - 120000);
  await expect
    .poll(async () => (await snapshot()).jobs.find((job) => job.url === url)?.state, {
      timeout: 45000,
    })
    .toBe('ASSEMBLING');
  expect((await snapshot()).jobs.find((job) => job.url === url)?.sha256).toBe(fixtureHash(3145728));
  await expect.poll(async () => (await snapshot()).settings.queues[0]?.paused).toBe(true);
});
test('periodic queues create new verified copies and completion sound uses a locally activated audio graph', async () => {
  await page.clock.install({ time: new Date(2026, 9, 20, 12) });
  await open();
  await page.evaluate(() => {
    const Native = AudioContext;
    const scope = window as Window & { testTones?: number };
    scope.testTones = 0;
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: class extends Native {
        override createOscillator() {
          scope.testTones!++;
          return super.createOscillator();
        }
      },
    });
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Completion sound').check();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await page.getByRole('button', { name: 'Test completion sound', exact: true }).click();
  await home();
  await page.getByRole('button', { name: 'Manage queues', exact: true }).click();
  await page.getByRole('button', { name: 'New queue', exact: true }).click();
  await page.getByLabel('Queue name').fill('Periodic');
  await page.getByLabel('When all files are finished').selectOption('repeat');
  await page.getByLabel('Repeat queue every (minutes, 0 = once)').fill('1');
  await page.getByRole('button', { name: 'Save queue', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const url = `${base}/range?size=1048576&periodic=1`;
  await add(url, 'periodic.bin', 'Periodic');
  await expect
    .poll(
      async () =>
        (await snapshot()).jobs.filter((job) => job.url === url && job.state === 'ASSEMBLING')
          .length,
    )
    .toBe(1);
  await expect
    .poll(async () => (await snapshot()).settings.queues[0]?.nextRunAt ?? 0)
    .toBeGreaterThan(0);
  await page.clock.fastForward(61000);
  await expect
    .poll(
      async () =>
        (await snapshot()).jobs.filter((job) => job.url === url && job.state === 'ASSEMBLING')
          .length,
    )
    .toBe(2);
  const copies = (await snapshot()).jobs.filter((job) => job.url === url);
  expect(new Set(copies.map((job) => job.id)).size).toBe(2);
  expect(copies.every((job) => job.sha256 === fixtureHash(1048576))).toBe(true);
  expect(
    await page.evaluate(() => (window as Window & { testTones?: number }).testTones),
  ).toBeGreaterThanOrEqual(2);
});

test('a real temporary server failure persists its retry deadline through reload and recovers the same verified file', async () => {
  await page.clock.install({ time: new Date() });
  await open();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Retry failed downloads automatically').check();
  await page.getByLabel('Retry attempts', { exact: true }).fill('2');
  await page.getByLabel('First retry after (seconds)').fill('30');
  await page.getByLabel('Connection mode').selectOption('manual');
  await page.getByLabel('Maximum connections').selectOption('1');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await home();
  fixture.setRangeFailure('/queue-outage', 1048576);
  const url = `${base}/queue-outage?size=3145728`;
  await add(url, 'automatic-retry.bin');
  await expect
    .poll(async () => (await snapshot()).jobs.find((job) => job.url === url)?.queueRetryAt ?? 0)
    .toBeGreaterThan(0);
  const first = (await snapshot()).jobs.find((job) => job.url === url)!;
  expect(first.state).toBe('FAILED');
  expect(first.retryFailure).toBeTruthy();
  expect(first.queueRetries ?? 0).toBe(0);
  expect(first.downloaded).toBe(1048576);
  expect(first.segments).toHaveLength(1);
  const failedRequests = fixture.stats.requests;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  expect((await snapshot()).jobs.find((job) => job.id === first.id)?.queueRetryAt).toBe(
    first.queueRetryAt,
  );
  expect(fixture.stats.requests).toBe(failedRequests);
  fixture.setRangeFailure('/queue-outage', null);
  await page.clock.fastForward(60000);
  await expect
    .poll(async () => (await snapshot()).jobs.find((job) => job.id === first.id)?.state)
    .toBe('ASSEMBLING');
  const done = (await snapshot()).jobs.find((job) => job.id === first.id)!;
  expect(done.sha256).toBe(fixtureHash(3145728));
  expect(done.segments.find((segment) => segment.start === 0)).toEqual(first.segments[0]);
  expect(fixture.stats.ranges.filter((range) => range === 'bytes=0-1048575')).toHaveLength(1);
  expect(done.queueRetries).toBe(1);
  expect(done.queueRetryAt).toBeNull();
});

test('per-queue retry overrides stop on manual pause and never requeue login failures', async () => {
  await page.clock.install({ time: new Date() });
  await open();
  await page.getByRole('button', { name: 'Manage queues', exact: true }).click();
  await page.getByRole('button', { name: 'New queue', exact: true }).click();
  await page.getByLabel('Queue name').fill('Retry policy');
  await page.getByText('Automatic retry', { exact: true }).click();
  await page.getByLabel('Override automatic retry defaults').check();
  await page.getByLabel('Queue automatic retry attempts (0 = off)').fill('1');
  await page.getByLabel('Queue initial retry delay (seconds)').fill('30');
  await page.getByRole('button', { name: 'Save queue', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const auth = `${base}/auth?size=1048576`;
  await add(auth, 'login-requires-attention.bin', 'Retry policy');
  await expect
    .poll(async () => (await snapshot()).jobs.find((job) => job.url === auth)?.state)
    .toBe('FAILED');
  expect((await snapshot()).jobs.find((job) => job.url === auth)?.retryFailure).toBeNull();
  fixture.setOutage('/manual-stop', true);
  const url = `${base}/manual-stop?size=1048576`;
  await add(url, 'stopped-retry.bin', 'Retry policy');
  await expect(
    page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: 'stopped-retry.bin', exact: true }) })
      .getByText('Retry scheduled', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pause all', exact: true }).click();
  await expect
    .poll(async () => (await snapshot()).jobs.find((job) => job.url === url)?.retryFailure)
    .toBeNull();
  const requests = fixture.stats.requests;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  fixture.setOutage('/manual-stop', false);
  await page.clock.fastForward(120000);
  expect(fixture.stats.requests).toBe(requests);
  expect((await snapshot()).jobs.filter((job) => job.state === 'FAILED')).toHaveLength(2);
});
