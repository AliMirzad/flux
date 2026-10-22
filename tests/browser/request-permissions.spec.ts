import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Use the release manifest unchanged: other capture suites pregrant website access.
test('fresh install and worker wake do not register observers without website access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flux-request-permissions-'));
  const executablePath = process.env.CHROME_PATH;
  const context = await chromium.launchPersistentContext(root, {
    headless: true,
    executablePath,
    channel: executablePath ? undefined : 'chromium',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  try {
    const cdp = await context.browser()!.newBrowserCDPSession();
    const extensions = await context.newPage();
    await extensions.goto('chrome://extensions');
    await extensions.evaluate(() => {
      const api = (
        chrome as unknown as {
          developerPrivate: {
            updateProfileConfiguration(config: { inDeveloperMode: boolean }): void;
          };
        }
      ).developerPrivate;
      api.updateProfileConfiguration({ inDeveloperMode: true });
    });
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('dist') });
    const manager = await context.newPage();
    await manager.goto(`chrome-extension://${id}/manager.html`);
    await expect(manager.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
    await manager.getByRole('button', { name: 'Settings', exact: true }).click();
    // Reproduce the API shape observed after a first permission grant: request
    // succeeds but this document's native bindings remain unavailable until reload.
    await manager.evaluate(() => {
      chrome.permissions.request = async () => true;
    });
    await manager.getByRole('button', { name: 'Check companion connection', exact: true }).click();
    await expect(manager.getByRole('alert')).toContainText('Chrome needs Flux to reload');
    await expect(manager.getByRole('alert')).not.toContainText('Install the macOS companion');
    await manager.getByRole('button', { name: 'Reload Flux', exact: true }).click();
    await expect(manager.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
    const granted = await manager.evaluate(() => chrome.permissions.getAll());
    expect(granted.origins ?? []).toEqual([]);
    const errors = () =>
      extensions.evaluate(
        (extensionId) =>
          new Promise<{
            runtimeWarnings: string[];
            runtimeErrors: { message: string }[];
            manifestErrors: { message: string }[];
          }>((done) => {
            const api = (
              chrome as unknown as {
                developerPrivate: { getExtensionInfo(id: string, callback: typeof done): void };
              }
            ).developerPrivate;
            api.getExtensionInfo(extensionId, done);
          }),
        id,
      );
    expect(await errors()).toMatchObject({
      runtimeWarnings: [],
      runtimeErrors: [],
      manifestErrors: [],
    });
    const { targetInfos } = await cdp.send('Target.getTargets');
    const worker = targetInfos.find(
      (target) =>
        target.type === 'service_worker' && target.url === `chrome-extension://${id}/background.js`,
    )!;
    expect(worker).toBeTruthy();
    await cdp.send('Target.closeTarget', { targetId: worker.targetId });
    const response = await manager.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'prepare-request', url: 'https://example.com/test.bin' }),
    );
    expect(response.permissionOrigin).toBe('https://example.com');
    expect(await errors()).toMatchObject({
      runtimeWarnings: [],
      runtimeErrors: [],
      manifestErrors: [],
    });
    await cdp.detach();
  } finally {
    await context.close();
    await rm(root, { recursive: true, force: true });
  }
});
