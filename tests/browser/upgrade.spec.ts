import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture, fixtureHash } from '../fixtures/server';
import type { Snapshot } from '../../src/domain/model';

test('0.10 upgrade preserves settings, queues and verified partial data in the same extension folder', async () => {
  const baseline = resolve(process.env.FLUX_UPGRADE_FROM ?? 'releases/flux-0.10.0');
  test.skip(
    !(await stat(join(baseline, 'manifest.json')).then(
      () => true,
      () => false,
    )),
    'Provide the original unpacked 0.10 release using FLUX_UPGRADE_FROM.',
  );
  expect(JSON.parse(await readFile(join(baseline, 'manifest.json'), 'utf8')).version).toBe(
    '0.10.0',
  );
  const fixture = await startFixture();
  const parent = resolve(process.env.FLUX_TEST_ROOT ?? tmpdir());
  const root = await mkdtemp(join(parent, 'flux-upgrade-'));
  const extension = join(root, 'extension'),
    profile = join(root, 'profile');
  let context: BrowserContext | undefined, page: Page, id: string;
  const install = async (source: string) => {
    await cp(source, extension, { recursive: true });
    const path = join(extension, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.host_permissions = ['http://downloads.example.com/*'];
    await writeFile(path, JSON.stringify(manifest));
  };
  const launch = async () => {
    const executablePath = process.env.CHROME_PATH;
    context = await chromium.launchPersistentContext(profile, {
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
      const session = await context.browser()!.newBrowserCDPSession();
      id = (await session.send('Extensions.loadUnpacked', { path: extension })).id;
      await session.detach();
    } else
      id = new URL(
        (context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))).url(),
      ).host;
    page = await context.newPage();
    await page.goto(`chrome-extension://${id}/manager.html`);
    await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
  };
  const snapshot = () =>
    page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'snapshot' })) as Snapshot);
  try {
    await install(baseline);
    await launch();
    const originalId = id!;
    await page!.getByRole('button', { name: 'Settings', exact: true }).click();
    await page!.getByLabel('Automatically save finished downloads').uncheck();
    await page!.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await page!.getByRole('button', { name: /All downloads/ }).click();
    await page!.getByRole('button', { name: 'Manage queues', exact: true }).click();
    await page!.getByRole('button', { name: 'New queue', exact: true }).click();
    await page!.getByLabel('Queue name').fill('Upgrade acceptance');
    await page!.getByRole('button', { name: 'Save queue', exact: true }).click();
    await page!.getByRole('button', { name: 'Close', exact: true }).click();
    const size = 8 * 1024 ** 2,
      filename = 'upgrade-retained.bin';
    await page!.getByRole('button', { name: 'Add download', exact: true }).click();
    await page!
      .getByLabel('Download URL')
      .fill(
        `${fixture.url.replace('127.0.0.1', 'downloads.example.com')}/slow?size=${size}&delay=20`,
      );
    await page!.getByLabel('File name optional').fill(filename);
    await page!.getByRole('button', { name: 'Start Download', exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).jobs[0]?.segments.length ?? 0)
      .toBeGreaterThan(0);
    await page!.getByRole('button', { name: `Pause ${filename}`, exact: true }).click();
    await expect.poll(async () => (await snapshot()).jobs[0]?.state).toBe('PAUSED');
    const before = await snapshot();
    expect(before.jobs[0]!.segments.length).toBeGreaterThan(0);
    const ranges = fixture.stats.ranges.length;
    await context!.close();
    context = undefined;
    if (!resolve(extension).startsWith(root + sep))
      throw new Error('Unexpected isolated upgrade target.');
    await rm(extension, { recursive: true, force: true });
    await install(resolve('dist'));
    await launch();
    expect(id!).toBe(originalId);
    const after = await snapshot();
    expect(after.settings).toEqual(before.settings);
    expect(after.jobs[0]!.segments).toEqual(before.jobs[0]!.segments);
    expect(after.jobs[0]!.state).toBe('PAUSED');
    expect(await page!.evaluate(() => chrome.runtime.getManifest().version_name)).toBe(
      '1.0.0-rc.1',
    );
    await page!.getByRole('button', { name: `Resume ${filename}`, exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).jobs[0]?.state, { timeout: 60000 })
      .toBe('ASSEMBLING');
    const completed = (await snapshot()).jobs[0]!;
    expect(completed.sha256).toBe(fixtureHash(size));
    for (const segment of before.jobs[0]!.segments)
      expect(fixture.stats.ranges.slice(ranges)).not.toContain(
        `bytes=${segment.start}-${segment.end}`,
      );
    const proof = JSON.stringify(
      {
        from: '0.10.0',
        to: '1.0.0-rc.1',
        chrome: context!.browser()!.version(),
        sameExtensionId: true,
        settingsAndQueuesRetained: true,
        retainedBytes: before.jobs[0]!.downloaded,
        verifiedBytes: completed.total,
        sha256: completed.sha256,
        retainedRangesReplayed: false,
      },
      null,
      2,
    );
    await writeFile('test-results/upgrade-proof-v1.json', proof + '\n');
    await test.info().attach('upgrade-proof', {
      contentType: 'application/json',
      body: proof,
    });
  } finally {
    await context?.close();
    await fixture.close();
    if (!root.startsWith(join(parent, 'flux-upgrade-')))
      throw new Error('Unexpected upgrade cleanup target.');
    await rm(root, { recursive: true, force: true });
  }
});
