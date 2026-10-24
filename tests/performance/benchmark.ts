import { chromium, type Page } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, cpus, totalmem, release, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { startFixture, fixtureHash } from '../fixtures/server';
import { defaultSettings } from '../../src/domain/model';
import { ChromeMetrics } from './metrics';
const fixture = await startFixture();
const root = await mkdtemp(join(process.env.FLUX_TEST_ROOT ?? tmpdir(), 'flux-benchmark-'));
const extensionPath = join(root, 'extension');
await cp(resolve('dist'), extensionPath, { recursive: true });
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://downloads.example.com/*'];
await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
const executablePath = process.env.CHROME_PATH;
const output = join(root, 'native');
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext(join(root, 'profile'), {
  headless: true,
  channel: executablePath ? undefined : 'chromium',
  executablePath,
  acceptDownloads: true,
  downloadsPath: output,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    ...(executablePath
      ? []
      : [`--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`]),
    '--enable-unsafe-extension-debugging',
    '--no-proxy-server',
    '--host-resolver-rules=MAP downloads.example.com 127.0.0.1',
    '--disable-features=LocalNetworkAccessChecks',
  ],
});
const browserSession = await context.browser()!.newBrowserCDPSession();
let id: string;
if (executablePath)
  id = (await browserSession.send('Extensions.loadUnpacked', { path: extensionPath })).id;
else {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  id = new URL(sw.url()).host;
}
const base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
const size = Number(process.env.BENCH_SIZE_MIB ?? 16) * 1024 ** 2;
const repetitions = Number(process.env.BENCH_REPEATS ?? 3);
const delay = Number(process.env.BENCH_DELAY_MS ?? 32);
const expected = fixtureHash(size);
const results: {
  mode: string;
  seconds: number;
  mibps: number;
  cpuSeconds: number | null;
  heapBytes: number;
  peakPrivateBytes: number | null;
  peakWorkingSetBytes: number | null;
  processSamples: number;
  metricsErrors: string[];
  maxActive: number;
  verified: boolean;
  error: string | null;
}[] = [];
async function getJob(page: Page, name: string) {
  return page.evaluate(async (filename) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('flux-downloads', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<any>((resolve, reject) => {
        const r = db.transaction('jobs').objectStore('jobs').getAll();
        r.onsuccess = () => resolve(r.result.find((job: any) => job.filename === filename));
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, name);
}
try {
  const idlePage = await context.newPage();
  await idlePage.goto(`chrome-extension://${id}/manager.html`);
  await idlePage.getByRole('heading', { name: 'All downloads.' }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const idleMetrics = new ChromeMetrics(browserSession);
  const idleStarted = performance.now();
  await idleMetrics.sample();
  for (let sample = 0; sample < 10; sample++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await idleMetrics.sample();
  }
  const idle = { seconds: (performance.now() - idleStarted) / 1000, ...idleMetrics.result() };
  await idlePage.close();
  console.log(
    `Chrome ${context.browser()!.version()}, ${size / 1024 ** 2} MiB, ${repetitions} repetitions; fixture 16KiB every ${delay}ms per response.`,
  );
  for (const mode of ['native', '1', '4', '8', '16', 'adaptive'])
    for (let repeat = 0; repeat < repetitions; repeat++) {
      fixture.reset();
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/manager.html`);
      await page.getByRole('heading', { name: 'All downloads.' }).waitFor();
      const settings = {
        ...defaultSettings,
        maxActive: 1,
        // Timing ends at verification; auto-save would move the job past ASSEMBLING unseen.
        autoSave: false,
        perHost: 16,
        maxConnections: mode === 'adaptive' ? 16 : Number(mode) || 1,
        mode: mode === 'adaptive' ? 'auto' : 'manual',
      };
      await page.evaluate(async (settings) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open('flux-downloads', 1);
          r.onsuccess = () => resolve(r.result);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('config', 'readwrite');
          tx.objectStore('config').put(settings, 'settings');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      }, settings);
      await page.reload();
      await page.getByRole('heading', { name: 'All downloads.' }).waitFor();
      const pageSession = await context.newCDPSession(page);
      await pageSession.send('Performance.enable');
      let peakHeap = 0;
      const resource = new ChromeMetrics(browserSession);
      await resource.sample();
      let lastResourceSample = performance.now();
      const sampleResources = async () => {
        if (performance.now() - lastResourceSample >= 1000) {
          await resource.sample();
          lastResourceSample = performance.now();
        }
      };
      const started = performance.now();
      let verified = false;
      let error: string | null = null;
      const name = `bench-${mode}-${repeat}.bin`;
      const url = `${base}/capped?size=${size}&delay=${delay}`;
      try {
        if (mode === 'native') {
          const download = await page.evaluate(
            (url) => chrome.downloads.download({ url, saveAs: false }),
            url,
          );
          let file: string | undefined;
          while (performance.now() - started < 180000) {
            await sampleResources();
            const item = await page.evaluate(
              async (id) => (await chrome.downloads.search({ id }))[0],
              download,
            );
            if (item?.state === 'interrupted') throw new Error(item.error ?? 'Native interrupted');
            if (item?.state === 'complete') {
              file = item.filename;
              break;
            }
            await new Promise((r) => setTimeout(r, 100));
          }
          if (!file) throw new Error('Native timeout');
          const hasher = createHash('sha256');
          for await (const chunk of createReadStream(file)) hasher.update(chunk);
          verified = hasher.digest('hex') === expected;
          await page.evaluate((id) => chrome.downloads.removeFile(id), download);
        } else {
          await page.getByRole('button', { name: 'Add download', exact: true }).click();
          await page.getByLabel('Download URL').fill(url);
          await page.getByLabel('File name optional').fill(name);
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Start Download', exact: true })
            .click();
          while (performance.now() - started < 180000) {
            await sampleResources();
            const job = await getJob(page, name);
            if (job?.state === 'FAILED') throw new Error(job.error);
            const metrics = await pageSession.send('Performance.getMetrics');
            peakHeap = Math.max(
              peakHeap,
              metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0,
            );
            if (job?.state === 'ASSEMBLING') {
              verified = job.sha256 === expected;
              break;
            }
            await new Promise((r) => setTimeout(r, 100));
          }
          if (!verified) throw new Error('Engine timeout or checksum mismatch');
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      const seconds = (performance.now() - started) / 1000;
      await resource.sample();
      const measured = resource.result();
      const row = {
        mode,
        seconds,
        mibps: size / 1024 ** 2 / seconds,
        cpuSeconds: measured.samples > 1 ? measured.cpuSeconds : null,
        heapBytes: peakHeap,
        peakPrivateBytes: measured.peakPrivateBytes,
        peakWorkingSetBytes: measured.peakWorkingSetBytes,
        processSamples: measured.samples,
        metricsErrors: measured.errors,
        maxActive: fixture.stats.maxActive,
        verified,
        error,
      };
      results.push(row);
      console.log(JSON.stringify(row));
      // Cleanup only this temporary test profile, after timing is complete.
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        try {
          await root.removeEntry('partials', { recursive: true });
        } catch {}
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open('flux-downloads', 1);
          r.onsuccess = () => resolve(r.result);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('jobs', 'readwrite');
          tx.objectStore('jobs').clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      });
      await page.close();
    }
  const median = (numbers: number[]) =>
    [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)] ?? 0;
  const rows = ['native', '1', '4', '8', '16', 'adaptive'].map((mode) => {
    const group = results.filter((r) => r.mode === mode);
    const cpu = group.flatMap((r) => (r.cpuSeconds === null ? [] : [r.cpuSeconds]));
    const peak = (field: 'peakPrivateBytes' | 'peakWorkingSetBytes') => {
      const values = group.flatMap((r) => (r[field] === null ? [] : [r[field]!]));
      return values.length ? (Math.max(...values) / 1024 ** 2).toFixed(1) : 'unmeasured';
    };
    return `| ${mode} | ${median(group.map((r) => r.mibps)).toFixed(2)} | ${group.filter((r) => r.error || !r.verified).length}/${group.length} | ${cpu.length ? median(cpu).toFixed(2) : 'unmeasured'} | ${Math.max(...group.map((r) => r.heapBytes)) / 1024 ** 2 < 0.01 ? 'unmeasured' : (Math.max(...group.map((r) => r.heapBytes)) / 1024 ** 2).toFixed(1)} | ${peak('peakPrivateBytes')} | ${peak('peakWorkingSetBytes')} |`;
  });
  await mkdir('docs', { recursive: true });
  await writeFile(
    'docs/benchmark-v1-data.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        platform: process.platform,
        environment: { cpu: cpus()[0]?.model, cores: cpus().length, totalMemoryBytes: totalmem(), osRelease: release(), arch: arch(), node: process.version },
        artifact: { version: manifest.version, versionName: manifest.version_name },
        chrome: context.browser()!.version(),
        size,
        repetitions,
        delay,
        idle,
        results,
      },
      null,
      2,
    ),
  );
  await writeFile(
    'docs/benchmark-v1-results.md',
    `# Measured fixture benchmark\n\nMeasured ${new Date().toISOString()} on ${process.platform} using Chrome ${context.browser()!.version()}. ${size / 1024 ** 2} MiB deterministic file; ${repetitions} repeats per mode; HTTP/1.1 fixture emits 16 KiB with ${delay}ms pacing per response. Fixture runs on loopback mapped to a public-looking test hostname. No user product networking bypass ships.\n\n| Mode | Median MiB/s | Failures | Median Chrome CPU seconds* | Peak manager JS heap MiB** | Peak private MiB | Peak working set MiB |\n|---|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\nTiming includes probe, UI admission, OPFS persistence and final checksum for Flux; native timing includes completion and independent disk SHA-256. It excludes Flux final user-file export, which requires another streamed copy. These are local fixture results, not Internet performance or IDM comparisons. Native Chrome may use different request/transport behavior. HTTP/1.1 connection pools limit useful concurrency; configured fetch counts are not guaranteed transport socket counts.\n\n* CDP SystemInfo cumulative CPU delta across Chrome processes; processes created or exited during sampling can affect this estimate. Fixture Node CPU excluded.\n\n** CDP Performance JSHeapUsedSize for the manager renderer, sampled every 100ms; excludes dedicated-worker heaps, browser native buffers, OPFS caches, GPU and total process RSS. Native heap not sampled. Process private bytes and summed working sets are sampled for all Chrome PIDs reported by SystemInfo (including dedicated workers); raw repetitions contain both peaks and sample errors. Summed working sets can double-count shared pages. Sampler subprocess/fixture CPU is excluded. A separate idle sample keeps the empty manager open for ${idle.seconds.toFixed(1)} seconds: ${idle.cpuSeconds.toFixed(3)} Chrome CPU seconds (${((100 * idle.cpuSeconds) / idle.seconds).toFixed(2)}% of one CPU core), ${idle.peakPrivateBytes === null ? 'unmeasured' : (idle.peakPrivateBytes / 1024 ** 2).toFixed(1)} MiB peak private bytes. It is a short observation, not a universal idle guarantee. No IDM installation was used. Raw repetitions: [benchmark-v1-data.json](benchmark-v1-data.json).\n\nNative OS Save As picker, macOS, real network variation, browser/OS crash durability, 5/10 GiB and real-world authenticated URLs are outside this benchmark.\n`,
  );
  if (results.some((result) => result.error || !result.verified)) process.exitCode = 1;
} finally {
  await context.close();
  await fixture.close();
  await rm(root, { recursive: true, force: true });
}
