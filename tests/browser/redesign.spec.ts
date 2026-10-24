import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture } from '../fixtures/server';

let context: BrowserContext;
let root: string;
let id: string;
let page: Page;
let fixture: Awaited<ReturnType<typeof startFixture>>;
const errors: string[] = [];
const screenshotRoot = 'test-results/redesign';

async function shot(name: string, target = page) {
  await target.screenshot({ path: `${screenshotRoot}/${name}.png`, animations: 'disabled' });
}
async function fits(target = page) {
  expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const dialog = target.getByRole('dialog');
  if (await dialog.count()) {
    const box = await dialog.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(target.viewportSize()!.height + 1);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
  }
}
async function settings() {
  if (
    page.viewportSize()!.width <= 680 &&
    !(await page.getByRole('button', { name: 'Settings', exact: true }).isVisible())
  ) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}
async function home() {
  if (
    page.viewportSize()!.width <= 680 &&
    !(await page.getByRole('button', { name: /^All downloads/ }).isVisible())
  ) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  }
  await page.getByRole('button', { name: /^All downloads/ }).click();
  await page.evaluate(() => scrollTo(0, 0));
}
async function closeDialog() {
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
}

test.beforeAll(async () => {
  fixture = await startFixture();
  root = await mkdtemp(join(tmpdir(), 'flux-redesign-'));
  const extension = join(root, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // Test copy only: pregrant fixture hosts to avoid permission prompts in the isolated profile.
  manifest.host_permissions = ['http://*/*', 'https://*/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const executablePath =
    process.env.CHROME_PATH ||
    (process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined);
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    executablePath,
    channel: executablePath ? undefined : 'chromium',
    headless: true,
    viewport: { width: 1672, height: 941 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--enable-unsafe-extension-debugging',
      '--no-proxy-server',
      '--host-resolver-rules=MAP downloads.example.com 127.0.0.1',
      '--disable-features=LocalNetworkAccessChecks',
    ],
  });
  const cdp = await context.browser()!.newBrowserCDPSession();
  id = (await cdp.send('Extensions.loadUnpacked', { path: extension })).id;
  await cdp.detach();
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/manager.html`);
  await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  await mkdir(screenshotRoot, { recursive: true });
});

test.afterAll(async () => {
  await context?.close();
  await fixture?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
test('all redesigned flows in both themes, with real settings persistence and paused downloads', async () => {
  for (const theme of ['light', 'dark']) {
    await settings();
    await page.locator('select[name="theme"]').selectOption(theme);
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await expect(page.getByText('Preferences saved')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await settings();
    await page
      .locator('#settings-transfers')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await shot(`${theme}-settings-transfers`);
    await fits();
    await page.getByLabel('Connection mode', { exact: true }).selectOption('manual');
    await page.getByLabel('Maximum connections', { exact: true }).selectOption('8');
    await page.getByLabel('Only during certain hours').check();
    await expect(page.locator('input[name="windowStart"]')).toBeVisible();
    await page.getByLabel('Any time', { exact: false }).check();
    await page.locator('#settings-schedule').scrollIntoViewIfNeeded();
    await shot(`${theme}-settings-schedule`);
    await page.locator('#settings-saving').scrollIntoViewIfNeeded();
    await shot(`${theme}-settings-saving`);
    await page.locator('#settings-browser').scrollIntoViewIfNeeded();
    await shot(`${theme}-settings-browser`);
    await page.locator('#settings-storage').scrollIntoViewIfNeeded();
    await shot(`${theme}-settings-storage`);
    await home();
    await shot(`${theme}-dashboard`);
    await fits();
    await page.getByRole('button', { name: 'Add download', exact: true }).click();
    await page.getByLabel('Download URL').fill('https://example.com/design-reference.zip');
    await shot(`${theme}-add-general`);
    await page.getByRole('tab', { name: 'Advanced', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tabpanel', { name: 'Advanced', exact: true })).toBeVisible();
    await shot(`${theme}-add-advanced`);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tabpanel', { name: 'Schedule', exact: true })).toBeVisible();
    await shot(`${theme}-add-schedule`);
    await fits();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add multiple links', exact: true }).click();
    await shot(`${theme}-batch-empty`);
    await page
      .getByLabel('Download links', { exact: true })
      .fill('https://example.com/first.zip\nhttps://example.com/second.pdf');
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await shot(`${theme}-batch-review`);
    await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add selected downloads' })).toBeDisabled();
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await page.getByText('Generate a numbered series', { exact: false }).click();
    await page.getByLabel('First link of the series').fill('https://example.com/video-01.mp4');
    await page.getByLabel('Last number', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Generate links', exact: true }).click();
    await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
    await fits();
    await closeDialog();
    await page.getByRole('button', { name: 'Manage queues', exact: true }).click();
    await shot(`${theme}-queues`);
    await page.getByRole('button', { name: 'New queue', exact: true }).click();
    await page.getByLabel('Queue name', { exact: true }).fill('Evening downloads');
    await page.getByLabel('Start on a schedule').check();
    await shot(`${theme}-queue-editor`);
    await fits();
    await closeDialog();
    const popup = await context.newPage();
    popup.on('pageerror', (error) => errors.push(error.message));
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'Ready for your next file' })).toBeVisible();
    await shot(`${theme}-popup`, popup);
    await fits(popup);
    expect(
      await popup.locator('.popup-shell').evaluate((element) => element.scrollHeight <= 600),
    ).toBe(true);
    await popup.close();
  }
  // Exercise the actual Add action without starting a network transfer.
  await home();
  await page.getByRole('button', { name: 'Add download', exact: true }).click();
  await page.getByLabel('Download URL').fill('https://example.com/redesign-check.zip');
  await page.getByLabel('File name optional').fill('redesign-check.zip');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'redesign-check.zip', exact: true }).click();
  await shot('dark-details');
  for (const name of ['Connections', 'Timeline', 'Overview']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await fits();
  }
  await closeDialog();
  for (const width of [1000, 760, 620, 390]) {
    await page.setViewportSize({ width, height: 760 });
    await fits();
    await shot(`responsive-${width}`);
    await page.getByRole('button', { name: 'Add download', exact: true }).click();
    await fits();
    await shot(`responsive-add-${width}`);
    await closeDialog();
    await page.getByRole('button', { name: 'Add multiple links', exact: true }).click();
    await fits();
    await shot(`responsive-batch-${width}`);
    await closeDialog();
    await settings();
    await page
      .locator('#settings-transfers')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await fits();
    await shot(`responsive-settings-${width}`);
    await home();
  }
  expect(errors).toEqual([]);
});

test('batch import, selected downloads, queue files, and a real active transfer in the popup', async () => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await home();
  await page.getByRole('button', { name: 'Add multiple links', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'downloads.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'https://example.com/imported-one.zip\nhttps://example.com/imported-two.zip',
    ),
  });
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.getByLabel('Add paused', { exact: true }).check();
  await page.getByRole('button', { name: 'Add selected downloads' }).click();
  await expect(page.getByRole('status')).toContainText('2 added');
  await closeDialog();
  await expect(page.getByRole('button', { name: 'imported-one.zip', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage queues', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('.queue-files')).toContainText('imported-one.zip');
  await shot('dark-queue-files');
  await closeDialog();
  // A deliberately slow local fixture keeps the real engine active while the UI is inspected.
  const url = `${fixture.url.replace('127.0.0.1', 'downloads.example.com')}/slow?size=20971520&delay=50`;
  for (const theme of ['light', 'dark']) {
    await settings();
    await page.locator('select[name="theme"]').selectOption(theme);
    await page.getByLabel('Automatically save finished downloads').uncheck();
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await expect(page.getByText('Preferences saved')).toBeVisible();
    await home();
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Add download', exact: true }).click();
      await page.getByLabel('Download URL').fill(url);
      await page.getByLabel('File name optional').fill('active-transfer.zip');
      await page.getByRole('button', { name: 'Start Download', exact: true }).click();
    }
    await expect(
      page.getByRole('button', { name: 'Pause active-transfer.zip', exact: true }),
    ).toBeVisible();
    await shot(`${theme}-active-dashboard`);
    const popup = await context.newPage();
    popup.setDefaultTimeout(10000);
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(
      popup.getByRole('button', { name: 'Pause active-transfer.zip', exact: true }),
    ).toBeVisible();
    await shot(`${theme}-popup-active`, popup);
    await fits(popup);
    await popup.getByRole('button', { name: 'Pause active-transfer.zip', exact: true }).click();
    await expect(
      popup.getByRole('button', { name: 'Resume active-transfer.zip', exact: true }),
    ).toBeVisible();
    await popup.getByRole('button', { name: 'Resume active-transfer.zip', exact: true }).click();
    await expect(
      popup.getByRole('button', { name: 'Pause active-transfer.zip', exact: true }),
    ).toBeVisible();
    await popup.close();
  }
  await page.getByRole('button', { name: 'Pause active-transfer.zip', exact: true }).click();
  expect(errors).toEqual([]);
});

test('captured links use the redesigned queue chooser and embedded Add Download', async () => {
  await settings();
  await page.getByLabel('Automatically capture downloads').check();
  await page.locator('input[name="confirmCapture"]').uncheck();
  await page.getByLabel('Ask which queue before each download').check();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await home();
  await page.getByRole('button', { name: 'Manage queues', exact: true }).click();
  await page.getByRole('button', { name: 'New queue', exact: true }).click();
  await page.getByLabel('Queue name', { exact: true }).fill('Review queue');
  await page.getByRole('button', { name: 'Save queue', exact: true }).click();
  await closeDialog();
  const site = await context.newPage();
  await site.goto(`${fixture.url.replace('127.0.0.1', 'downloads.example.com')}/capture-page`);
  await site.locator('#normal').click();
  const popup = await context.newPage();
  popup.setDefaultTimeout(10000);
  await popup.setViewportSize({ width: 600, height: 600 });
  await expect
    .poll(async () => {
      await popup.goto(`chrome-extension://${id}/popup.html`);
      return popup.getByRole('region', { name: 'Choose a queue' }).count();
    })
    .toBe(1);
  await popup.getByRole('radio', { name: /Review queue/ }).check();
  await shot('dark-capture-queue-chooser', popup);
  await fits(popup);
  await popup.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'file.zip', exact: true })).toBeVisible();
  await settings();
  await page.locator('input[name="confirmCapture"]').check();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  await home();
  await site.locator('#normal').evaluate((anchor) => {
    (anchor as HTMLAnchorElement).href += '&dialog-review=1';
  });
  await site.locator('#normal').click();
  await expect
    .poll(async () => {
      await popup.goto(`chrome-extension://${id}/popup.html`);
      return popup.getByLabel('Download URL').count();
    })
    .toBe(1);
  for (const tab of ['General', 'Advanced', 'Schedule']) {
    await popup.getByRole('tab', { name: tab, exact: true }).click();
    await shot(`dark-captured-add-${tab.toLowerCase()}`, popup);
    await fits(popup);
  }
  await popup.getByRole('tab', { name: 'General', exact: true }).click();
  await popup.getByRole('button', { name: 'Start Download', exact: true }).click();
  await popup.close();
  await site.close();
});

test('sidebar fits short windows and download details separates overview from editable settings', async () => {
  for (const height of [941, 768, 650, 600, 540, 480]) {
    await page.setViewportSize({ width: 1280, height });
    await home();
    await expect(page.getByRole('button', { name: 'Quick menu' })).toHaveCount(0);
    const sidebar = page.locator('.sidebar');
    expect(
      await sidebar.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    ).toBe(true);
    const bounds = await sidebar.boundingBox();
    for (const button of await sidebar.locator('.nav-item').all()) {
      const box = await button.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(bounds!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
    }
    await shot(`sidebar-height-${height}`);
  }
  await page.setViewportSize({ width: 1280, height: 768 });
  for (const theme of ['light', 'dark']) {
    await settings();
    await page.locator('select[name="theme"]').selectOption(theme);
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await expect(page.getByText('Preferences saved')).toBeVisible();
    await home();
    await page.getByRole('button', { name: 'redesign-check.zip', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Source URL', { exact: true })).toBeVisible();
    await expect(dialog.locator('input[name="filename"]')).toBeHidden();
    await shot(`${theme}-details-overview`);
    await fits();
    await dialog.getByRole('tab', { name: 'Settings', exact: true }).click();
    await dialog.locator('input[name="speedLimit"]').fill('64');
    await dialog.locator('select[name="priority"]').selectOption('2');
    await dialog.getByRole('tab', { name: 'Settings', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('tabpanel', { name: 'Connections', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.locator('input[name="speedLimit"]')).toHaveValue('64');
    await expect(dialog.locator('select[name="priority"]')).toHaveValue('2');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Changes saved');
    await dialog.locator('input[name="speedLimit"]').fill('65');
    await expect(dialog.getByText('Changes saved', { exact: true })).toHaveCount(0);
    await dialog.locator('input[name="speedLimit"]').fill('64');
    await shot(`${theme}-details-settings`);
    await closeDialog();
    await page.getByRole('button', { name: 'redesign-check.zip', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(dialog.locator('input[name="speedLimit"]')).toHaveValue('64');
    await expect(dialog.locator('select[name="priority"]')).toHaveValue('2');
    await page.setViewportSize({ width: 390, height: 760 });
    await fits();
    await shot(`${theme}-details-small`);
    await closeDialog();
    await page.setViewportSize({ width: 1280, height: 768 });
  }
  expect(errors).toEqual([]);
});

test('compact rows and visible download fields persist without hiding names or actions', async () => {
  await home();
  await page.getByText('View options', { exact: true }).click();
  await page.getByLabel('Compact rows', { exact: true }).check();
  await page.getByLabel('Website and category', { exact: true }).uncheck();
  await page.getByLabel('Transferred size', { exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'redesign-check.zip', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Details for redesign-check.zip', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('.downloads-section')).toHaveAttribute('data-compact', 'true');
  await expect(page.locator('.downloads-section')).toHaveAttribute('data-metadata', 'false');
  await expect(page.locator('.downloads-section')).toHaveAttribute('data-size', 'false');
  await page.getByText('View options', { exact: true }).click();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.getByText('View options', { exact: true }).click();
  await expect(page.locator('.downloads-section')).toHaveAttribute('data-compact', 'false');
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['light', 'dark']) {
    await settings();
    await page.locator('select[name="theme"]').selectOption(theme);
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await home();
    await fits();
    await shot(`store-manager-${theme}`);
  }
});
