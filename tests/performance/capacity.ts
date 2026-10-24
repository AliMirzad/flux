import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type CDPSession,
} from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, statfs, rm, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve, join, sep, dirname } from 'node:path';
import { tmpdir, cpus, totalmem, release, arch } from 'node:os';
import { startFixture, fixtureHash } from '../fixtures/server';
import { ChromeMetrics } from './metrics';
import type { Snapshot, DownloadJob } from '../../src/domain/model';

const parent = resolve(process.env.FLUX_TEST_ROOT ?? tmpdir());
const nativeExport = process.env.FLUX_CAPACITY_NATIVE === '1';
const report = process.env.FLUX_CAPACITY_REPORT ?? 'docs/capacity-v1.json';
const sizes = (process.env.FLUX_CAPACITY_MIB ?? '1024,5120,10240').split(',').map(Number);
if (sizes.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 10240))
  throw Error('Invalid capacity size.');
const disk = await statfs(parent);
const required = Math.max(...sizes) * 1024 ** 2 * 2 + 2 * 1024 ** 3;
if (disk.bavail * disk.bsize < required)
  throw Error('Capacity test needs space for staging, complete export and 2 GiB headroom.');
const root = await mkdtemp(join(parent, 'flux-capacity-'));
const extension = join(root, 'extension'),
  profile = join(root, 'profile');
const nativeDirectory = join(root, 'native');
if (nativeExport) {
  await mkdir(join(profile, 'Default'), { recursive: true });
  await mkdir(nativeDirectory, { recursive: true });
  await writeFile(
    join(profile, 'Default', 'Preferences'),
    JSON.stringify({
      download: { default_directory: nativeDirectory, prompt_for_download: false },
    }),
  );
}
await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
const executableHashes = Object.fromEntries(
  await Promise.all(
    (await readdir(join(extension, 'assets')))
      .filter((name) => name.endsWith('.js'))
      .map(async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(join(extension, 'assets', name)))
          .digest('hex'),
      ]),
  ),
);
manifest.host_permissions = ['http://downloads.example.com/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const fixture = await startFixture();
const base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
let context!: BrowserContext,
  page!: Page,
  id!: string,
  metrics!: ChromeMetrics,
  browserSession!: CDPSession;
const evidence: unknown[] = await readFile(report, 'utf8')
  .then((text) => JSON.parse(text) as unknown[])
  .catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
let succeeded = false;
async function launch() {
  const executablePath = process.env.CHROME_PATH;
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    acceptDownloads: nativeExport,
    ...(nativeExport ? { downloadsPath: nativeDirectory } : {}),
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
  const cdp = await context.browser()!.newBrowserCDPSession();
  browserSession = cdp;
  if (executablePath) id = (await cdp.send('Extensions.loadUnpacked', { path: extension })).id;
  else
    id = new URL(
      (context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))).url(),
    ).host;
  metrics = new ChromeMetrics(cdp);
  await metrics.sample();
  page = await context.newPage();
  page.on('pageerror', (error) => console.error('Manager page error: ' + error.message));
  await page.goto(`chrome-extension://${id}/manager.html`);
  await expect(page.getByRole('heading', { name: 'All downloads.' })).toBeVisible();
}
const job = (filename: string) =>
  page.evaluate(
    async (filename) =>
      ((await chrome.runtime.sendMessage({ type: 'snapshot' })) as Snapshot).jobs.find(
        (job) => job.filename === filename,
      ),
    filename,
  );
async function until(filename: string, predicate: (job: DownloadJob) => boolean) {
  const started = performance.now();
  let sampled = 0;
  while (performance.now() - started < 1200000) {
    const current = await job(filename);
    if (current?.state === 'FAILED') throw Error(current.error ?? 'Capacity download failed');
    if (current && predicate(current)) return current;
    if (performance.now() - sampled > 2000) {
      await metrics.sample();
      sampled = performance.now();
    }
    await page.waitForTimeout(250);
  }
  throw Error('Capacity phase exceeded its 20 minute deadline.');
}
try {
  await launch();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Automatically save finished downloads').uncheck();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByRole('button', { name: /All downloads/ }).click();
  for (const mib of sizes) {
    const filename = `capacity-${mib}.bin`,
      size = mib * 1024 ** 2;
    console.log(JSON.stringify({ phase: 'reference-hash', mib }));
    metrics = new ChromeMetrics(browserSession);
    await metrics.sample();
    const expected = fixtureHash(size);
    fixture.reset();
    console.log(JSON.stringify({ phase: 'download', mib }));
    const started = performance.now();
    await page.getByRole('button', { name: 'Add download', exact: true }).click();
    await page.getByLabel('Download URL').fill(
      mib < 128 ? `${base}/capped?size=${size}&delay=32` : `${base}/range?size=${size}`,
    );
    await page.getByLabel('File name optional').fill(filename);
    await page.getByRole('button', { name: 'Start Download', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await until(filename, (job) => job.downloaded >= Math.min(128 * 1024 ** 2, size / 2));
    await page.getByRole('button', { name: 'Pause all', exact: true }).click();
    const paused = await until(filename, (job) => job.state === 'PAUSED');
    if (!paused.segments.length) throw Error('Capacity pause retained no checkpoint.');
    await metrics.sample();
    const beforeRestart = metrics.result();
    const ranges = [...fixture.stats.ranges];
    await context.close();
    await launch();
    console.log(JSON.stringify({ phase: 'restart', mib, retainedBytes: paused.downloaded }));
    const restored = (await job(filename))!;
    expect(restored.segments).toEqual(paused.segments);
    await page.getByRole('button', { name: `Resume ${filename}`, exact: true }).click();
    const completed = await until(filename, (job) => job.state === 'ASSEMBLING');
    console.log(JSON.stringify({ phase: 'export', mib }));
    expect(completed.sha256).toBe(expected);
    expect(completed.downloaded).toBe(size);
    const afterRanges = fixture.stats.ranges.slice(ranges.length);
    for (const part of paused.segments)
      expect(afterRanges).not.toContain(`bytes=${part.start}-${part.end}`);
    const verifiedSeconds = (performance.now() - started) / 1000;
    const afterRestart = metrics.result();
    metrics = new ChromeMetrics(browserSession);
    await metrics.sample();
    await page.evaluate(() =>
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () =>
          (await navigator.storage.getDirectory()).getFileHandle('capacity-export.bin', {
            create: true,
          }),
      }),
    );
    await page.getByRole('button', { name: `Details for ${filename}`, exact: true }).click();
    const saving = page.getByRole('button', { name: /Save as/ }).click({ timeout: 1200000 });
    // Keep sampling while the real writable-stream export copies the complete staged file.
    let saveDone = false;
    void saving
      .finally(() => {
        saveDone = true;
      })
      .catch(() => undefined);
    while (!saveDone) {
      await metrics.sample();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    await saving;
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await until(filename, (job) => job.state === 'COMPLETED');
    const exportSeconds = (performance.now() - started) / 1000 - verifiedSeconds;
    const exportResources = metrics.result();
    metrics = new ChromeMetrics(browserSession);
    await metrics.sample();
    console.log(JSON.stringify({ phase: 'validate-export', mib }));
    const validating = page.evaluate(async () => {
      const file = await (
        await (await navigator.storage.getDirectory()).getFileHandle('capacity-export.bin')
      ).getFile();
      const reader = file.stream().getReader();
      let offset = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          for (let index = 0; index < value.length; index++) {
            const position = offset + index;
            if (value[index] !== (position * 31 + Math.floor(position / 251) * 17) % 256)
              throw Error('Export byte mismatch at ' + position);
          }
          offset += value.length;
        }
      } finally {
        reader.releaseLock();
      }
      return offset;
    });
    let validationDone = false;
    void validating
      .finally(() => {
        validationDone = true;
      })
      .catch(() => undefined);
    while (!validationDone) {
      await metrics.sample();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const validated = await validating;
    expect(validated).toBe(size);
    await metrics.sample();
    const validationResources = metrics.result();
    let nativeSave:
      | {
          seconds: number;
          bytes: number;
          sha256: string;
          resources: ReturnType<ChromeMetrics['result']>;
        }
      | undefined;
    if (nativeExport) {
      // Remove only the independently validated test export before creating the OS-file copy.
      await page.evaluate(async () =>
        (await navigator.storage.getDirectory()).removeEntry('capacity-export.bin'),
      );
      console.log(JSON.stringify({ phase: 'native-export', mib }));
      metrics = new ChromeMetrics(browserSession);
      await metrics.sample();
      const nativeStarted = performance.now();
      await page.getByRole('button', { name: `Details for ${filename}`, exact: true }).click();
      await page.getByRole('button', { name: 'Save again', exact: true }).click();
      const saved = await until(
        filename,
        (job) => job.state === 'COMPLETED' && Number.isInteger(job.savedDownloadId),
      );
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      const download = await page.evaluate(
        async (id) => (await chrome.downloads.search({ id }))[0],
        saved.savedDownloadId!,
      );
      expect(download?.state).toBe('complete');
      const destination = resolve(download!.filename);
      if (!destination.startsWith(root + sep))
        throw new Error('Native export escaped the isolated test directory.');
      const digest = createHash('sha256');
      let bytes = 0,
        sampled = performance.now();
      for await (const chunk of createReadStream(destination)) {
        digest.update(chunk);
        bytes += chunk.length;
        if (performance.now() - sampled > 2000) {
          await metrics.sample();
          sampled = performance.now();
        }
      }
      const sha256 = digest.digest('hex');
      expect(bytes).toBe(size);
      expect(sha256).toBe(expected);
      await metrics.sample();
      nativeSave = {
        seconds: (performance.now() - nativeStarted) / 1000,
        bytes,
        sha256,
        resources: metrics.result(),
      };
      await page.evaluate((id) => chrome.downloads.removeFile(id), saved.savedDownloadId!);
    }
    const row = {
      date: new Date().toISOString(),
      chrome: context.browser()!.version(),
      platform: process.platform,
      environment: { cpu: cpus()[0]?.model, cores: cpus().length, totalMemoryBytes: totalmem(), osRelease: release(), arch: arch(), node: process.version },
      artifact: { version: manifest.version, versionName: manifest.version_name, executableHashes },
      size,
      verifiedSeconds,
      exportSeconds,
      sha256: expected,
      checkpointBytes: paused.downloaded,
      restartPreserved: true,
      retainedRangesReplayed: false,
      exportedBytesIndependentlyValidated: validated,
      beforeRestart,
      afterRestart,
      exportResources,
      validationResources,
      ...(nativeSave ? { nativeSave } : {}),
    };
    evidence.push(row);
    console.log(JSON.stringify(row));
    await mkdir(dirname(report), { recursive: true });
    await writeFile(report, JSON.stringify(evidence, null, 2) + '\n');
    await page.evaluate(
      async ({ id, nativeExport }) => {
        const root = await navigator.storage.getDirectory();
        if (!nativeExport) await root.removeEntry('capacity-export.bin');
        await (await root.getDirectoryHandle('partials')).removeEntry(id);
      },
      { id: completed.id, nativeExport },
    );
  }
  succeeded = true;
} catch (error) {
  console.error(
    await page
      ?.locator('body')
      .innerText()
      .catch(() => 'Manager unavailable'),
  );
  console.error(error);
  throw error;
} finally {
  await context!?.close();
  await fixture.close();
  if (!resolve(root).startsWith(join(parent, 'flux-capacity-')))
    throw Error('Unexpected capacity cleanup target.');
  if (succeeded) await rm(root, { recursive: true, force: true });
  else console.log('Retained failed test profile: ' + root);
}
