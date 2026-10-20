import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Snapshot } from '../../src/domain/model';
const url = process.env.FLUX_LIVE_URL;
test('user-provided live URL transfers through Flux and matches an independent browser response', async () => {
  test.skip(!url, 'Set FLUX_LIVE_URL for the explicitly requested real-site diagnostic.');
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), 'flux-live-'));
  let context: BrowserContext | undefined;
  try {
    const extension = join(root, 'extension');
    await cp(resolve('dist'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions = ['https://*/*'];
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
      ],
    });
    let id: string;
    if (executablePath) {
      const cdp = await context.browser()!.newBrowserCDPSession();
      id = (await cdp.send('Extensions.loadUnpacked', { path: extension })).id;
      await cdp.detach();
    } else {
      id = new URL(
        (context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))).url(),
      ).host;
    }
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/manager.html`);
    await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
    if (process.env.FLUX_COLD_BACKGROUND === '1') {
      const cdp = await context.browser()!.newBrowserCDPSession();
      const targets = await cdp.send('Target.getTargets');
      const worker = targets.targetInfos.find(
        (target) =>
          target.type === 'service_worker' &&
          target.url === `chrome-extension://${id}/background.js`,
      );
      expect(worker).toBeTruthy();
      await cdp.send('Target.closeTarget', { targetId: worker!.targetId });
      await cdp.detach();
    }
    await page.getByRole('button', { name: 'Add download', exact: true }).click();
    await page.getByLabel('Download URL').fill(url!);
    await page.getByLabel('File name optional').fill('live-verified.zip');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add download', exact: true })
      .click();
    const getJob = async () => {
      const s = await page.evaluate(
        async () => (await chrome.runtime.sendMessage({ type: 'snapshot' })) as Snapshot,
      );
      return s.jobs.find((job) => job.filename === 'live-verified.zip');
    };
    // Observe the manager DOM; snapshot polling would wake the background and mask its lifecycle bug.
    await expect(
      page
        .locator('.download-card')
        .filter({ has: page.getByRole('button', { name: 'live-verified.zip', exact: true }) })
        .getByText('Ready to save', { exact: true }),
    ).toBeVisible({ timeout: 120000 });
    const job = (await getJob())!;
    expect(job.total).toBeGreaterThan(0);
    expect(job.sha256).toMatch(/^[a-f0-9]{64}$/);
    const reference = await page.evaluate(async (target) => {
      const response = await fetch(target, {
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
      });
      if (response.status !== 200)
        throw new Error(`Independent reference returned HTTP ${response.status}.`);
      const limit = 32 * 1024 * 1024;
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > limit) throw new Error('Live reference exceeds the diagnostic size limit.');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return {
        size,
        sha256: Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
        zipMagic: Array.from(bytes.subarray(0, 4)),
      };
    }, job.resource!.finalUrl);
    expect(reference.sha256).toBe(job.sha256);
    expect(reference.size).toBe(job.total);
    expect(reference.zipMagic.slice(0, 2)).toEqual([80, 75]);
    await mkdir('test-results', { recursive: true });
    await writeFile(
      'test-results/live-link-result.json',
      JSON.stringify(
        {
          sourceHost: new URL(url!).hostname,
          coldBackground: process.env.FLUX_COLD_BACKGROUND === '1',
          finalHost: new URL(job.resource!.finalUrl).hostname,
          size: job.total,
          sha256: job.sha256,
          ranges: job.resource!.ranges,
          segments: job.segments.length,
          referenceMatches: true,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        liveHost: new URL(url!).hostname,
        finalHost: new URL(job.resource!.finalUrl).hostname,
        size: job.total,
        sha256: job.sha256,
        referenceMatches: true,
      }),
    );
  } finally {
    await context?.close();
    await rm(root, { recursive: true, force: true });
  }
});
