import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { startFixture } from '../fixtures/server';
import { encodedSampleProof } from '../fixtures/sample-proof';
import type { Snapshot } from '../../src/domain/model';
import { createJob } from '../../src/application/jobs';
import { defaultSettings } from '../../src/domain/model';

let fixture: Awaited<ReturnType<typeof startFixture>>,
  context: BrowserContext,
  page: Page,
  root: string,
  extension: string,
  id: string,
  base: string;
const executablePath = process.env.CHROME_PATH;
const jobs = () =>
  page.evaluate(
    async () => ((await chrome.runtime.sendMessage({ type: 'snapshot' })) as Snapshot).jobs,
  );
async function launch() {
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
      '--host-resolver-rules=MAP downloads.example.com 127.0.0.1, MAP cdn.example.com 127.0.0.1',
      '--disable-features=LocalNetworkAccessChecks',
      '--autoplay-policy=no-user-gesture-required',
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
}
async function add(name: string, path: string, master = false, audioUrl?: string) {
  await page.getByRole('button', { name: 'Add download', exact: true }).click();
  await page.getByLabel('Download URL').fill(`${base}/hls/${path}`);
  await page.getByLabel('File name optional').fill(name);
  await page.getByRole('tab', { name: 'Advanced' }).click();
  await page.getByLabel('Download type').selectOption('hls');
  await page.getByRole('button', { name: 'Review HLS playlist', exact: true }).click();
  if (master) {
    await expect(page.getByLabel('Video quality')).toBeVisible();
    if (audioUrl) await page.getByLabel('Audio / language').selectOption(audioUrl);
    await page.getByRole('button', { name: 'Review selected quality', exact: true }).click();
  }
  await expect(page.getByRole('status').filter({ hasText: 'Output: MP4' })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Start Download', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return page
    .locator('.download-card')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
}
test.beforeAll(async () => {
  fixture = await startFixture();
  base = fixture.url.replace('127.0.0.1', 'downloads.example.com');
  root = await mkdtemp(join(tmpdir(), 'flux-media-'));
  extension = join(root, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://downloads.example.com/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await launch();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Automatically save finished downloads').uncheck();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByRole('button', { name: /All downloads/ }).click();
});
test.afterAll(async () => {
  await context?.close();
  await fixture?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
const playbackCases: {
  container: 'mp4' | 'mpegts';
  encrypted: boolean;
  separate?: 'original' | 'alternate';
}[] = [
  { container: 'mp4', encrypted: false },
  { container: 'mpegts', encrypted: false },
  { container: 'mp4', encrypted: true },
  { container: 'mpegts', encrypted: true },
  { container: 'mp4', encrypted: false, separate: 'original' },
  { container: 'mp4', encrypted: false, separate: 'alternate' },
  { container: 'mp4', encrypted: true, separate: 'alternate' },
];
for (const { container, encrypted, separate } of playbackCases)
  test(`HLS ${encrypted ? 'AES-128 ' : ''}${separate ? 'separate ' + separate + ' ' : ''}${container} produces an exported MP4 with decoded color, audio and seek markers`, async () => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const prefix = (encrypted ? 'aes-' : '') + (separate ? `separate-${separate}-` : ''),
      filename = `hls-playback-${prefix}${container}.mp4`;
    const card = await add(
      filename,
      separate
        ? `split/${encrypted ? 'enc-' : ''}master.m3u8`
        : encrypted
          ? `aes-${container === 'mpegts' ? 'ts-' : ''}vod.m3u8`
          : container === 'mpegts'
            ? 'ts-vod.m3u8'
            : 'master.m3u8',
      !!separate || (!encrypted && container === 'mp4'),
      separate
        ? `${base}/hls/split/${encrypted ? 'enc-' : ''}${separate === 'alternate' ? 'alternate' : 'audio'}.m3u8`
        : undefined,
    );
    await expect(card.getByText('Ready to save', { exact: true })).toBeVisible();
    await page.evaluate(() =>
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () =>
          (await navigator.storage.getDirectory()).getFileHandle('hls-export.mp4', {
            create: true,
          }),
      }),
    );
    await card.getByRole('button', { name: `Details for ${filename}`, exact: true }).click();
    await page.getByRole('button', { name: /Save as/ }).click();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(card.getByText('Completed', { exact: true })).toBeVisible();
    const exported = await page.evaluate(async () => {
      const handle = await (await navigator.storage.getDirectory()).getFileHandle('hls-export.mp4');
      const file = await handle.getFile();
      return Array.from(new Uint8Array(await file.arrayBuffer()));
    });
    const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
    const samples = encodedSampleProof(new Uint8Array(exported));
    const expectedSamples = encodedSampleProof(source);
    if (separate === 'alternate')
      expectedSamples.audio = [
        ...expectedSamples.audio.slice(94),
        ...expectedSamples.audio.slice(0, 94),
      ];
    expect(samples).toEqual(expectedSamples);
    if (container === 'mp4' && !separate) expect(Buffer.from(exported)).toEqual(source);
    if (separate)
      expect((await jobs()).find((job) => job.filename === filename)?.media?.audioLabel).toContain(
        separate === 'alternate' ? '(fa)' : '(en)',
      );
    expect((await jobs()).find((job) => job.filename === filename)?.sha256).toBe(
      createHash('sha256').update(Buffer.from(exported)).digest('hex'),
    );
    // Decode the actual exported bytes in an ordinary web page, independently of the extension worker.
    const playback = await context.newPage();
    await playback.goto(`${base}/capture-page`);
    const proof = await playback.evaluate(async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob),
        video = document.createElement('video');
      video.muted = true;
      video.src = url;
      document.body.append(video);
      const wait = (event: string) =>
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Playback timed out: ' + event)),
            15000,
          );
          video.addEventListener(
            event,
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
          video.addEventListener(
            'error',
            () => {
              clearTimeout(timeout);
              reject(new Error('Video decode failed'));
            },
            { once: true },
          );
        });
      await wait('loadedmetadata');
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d')!;
      const colors: number[][] = [];
      for (const time of [0.5, 2, 3.5]) {
        const seeked = wait('seeked');
        video.currentTime = time;
        await seeked;
        ctx.drawImage(video, 0, 0);
        colors.push(Array.from(ctx.getImageData(80, 45, 1, 1).data));
      }
      const audio = new AudioContext();
      const decoded = await audio.decodeAudioData(await blob.arrayBuffer());
      const channel = decoded.getChannelData(0),
        rate = decoded.sampleRate;
      const tones = [0.5, 2, 3.5].map((time) => {
        const start = Math.floor((time - 0.05) * rate),
          length = Math.floor(0.1 * rate);
        let crossings = 0,
          energy = 0;
        for (let index = start; index < start + length; index++) {
          energy += channel[index]! ** 2;
          if (channel[index]! <= 0 && channel[index + 1]! > 0) crossings++;
        }
        return { hz: crossings / (length / rate), rms: Math.sqrt(energy / length) };
      });
      await audio.close();
      video.remove();
      URL.revokeObjectURL(url);
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        colors,
        tones,
        audioDuration: decoded.duration,
      };
    }, exported);
    expect(proof.duration).toBeCloseTo(4.0832, 2);
    expect([proof.width, proof.height]).toEqual([160, 90]);
    for (const [index, color] of proof.colors.entries()) {
      expect(color[index]).toBeGreaterThan(240);
      expect(
        color.filter((_, channel) => channel < 3 && channel !== index).every((value) => value < 15),
      ).toBe(true);
      expect(
        Math.abs(
          proof.tones[index]!.hz -
            (separate === 'alternate' ? [880, 440, 880] : [440, 880, 1320])[index]!,
        ),
      ).toBeLessThan(25);
      expect(proof.tones[index]!.rms).toBeGreaterThan(0.04);
    }
    expect(Math.abs(proof.audioDuration - proof.duration)).toBeLessThan(0.2);
    expect(errors).toEqual([]);
    await test.info().attach('exported-playback-proof', {
      body: JSON.stringify(proof, null, 2),
      contentType: 'application/json',
    });
    await writeFile(
      `test-results/${prefix}${container === 'mpegts' ? 'ts' : 'hls'}-playback-proof.json`,
      JSON.stringify(
        {
          ...proof,
          bytes: exported.length,
          sha256: createHash('sha256').update(Buffer.from(exported)).digest('hex'),
          chrome: context.browser()!.version(),
          encodedSamples: {
            audio: samples.audio.length,
            video: samples.video.length,
            identicalToSource: separate !== 'alternate',
            identicalToSelectedSource: true,
            audioSelection: separate ?? 'muxed',
          },
        },
        null,
        2,
      ),
    );
    await playback.close();
  });
for (const encrypted of [false, true])
  for (const container of ['mp4', 'mpegts'] as const)
    test(`failed HLS ${encrypted ? 'AES-128 ' : ''}${container} part retains checkpoints across full Chrome restart and revalidates without replay`, async () => {
      const extension = container === 'mpegts' ? 'ts' : 'm4s';
      const prefix = encrypted ? 'aes-' : '',
        filename = `hls-recover-${prefix}${container}.mp4`,
        committed = container === 'mpegts' ? 1 : 2;
      fixture.reset();
      fixture.setOutage(`/hls/${prefix}part-1.${extension}`, true);
      const card = await add(
        filename,
        `${prefix}${container === 'mpegts' ? 'ts-' : ''}vod.m3u8?recovery=1`,
      );
      await expect(card.getByText('Failed', { exact: true })).toBeVisible({ timeout: 30000 });
      const before = (await jobs()).find((job) => job.filename === filename)!;
      expect(before.segments).toHaveLength(committed);
      expect(
        fixture.stats.methods.filter(
          (item) => item.path === `/hls/${prefix}part-0.${extension}` && item.method === 'GET',
        ),
      ).toHaveLength(1);
      await context.close();
      fixture.setOutage(`/hls/${prefix}part-1.${extension}`, false);
      await launch();
      const retained = (await jobs()).find((job) => job.id === before.id)!;
      expect(retained.segments).toHaveLength(committed);
      await page.getByRole('button', { name: `Retry ${filename}`, exact: true }).click();
      const resumed = page
        .locator('.download-card')
        .filter({ has: page.getByRole('button', { name: filename, exact: true }) });
      await expect(resumed.getByText('Ready to save', { exact: true })).toBeVisible();
      const source = await readFile(new URL('../fixtures/media/source.mp4', import.meta.url));
      expect((await jobs()).find((job) => job.id === before.id)?.sha256).toBe(
        container === 'mpegts'
          ? (await jobs()).find((job) => job.filename === 'hls-playback-mpegts.mp4')?.sha256
          : createHash('sha256').update(source).digest('hex'),
      );
      expect((await jobs()).find((job) => job.id === before.id)?.segments[0]).toEqual(
        before.segments[0],
      );
      expect(
        fixture.stats.methods.filter(
          (item) => item.path === `/hls/${prefix}part-0.${extension}` && item.method === 'GET',
        ),
      ).toHaveLength(1);
      expect(
        fixture.stats.methods.filter(
          (item) => item.path === `/hls/${prefix}part-0.${extension}` && item.method === 'HEAD',
        ),
      ).toHaveLength(1);
    });
for (const encrypted of [false, true])
  test(`separate ${encrypted ? 'AES-128 ' : ''}audio/video recover both retained sources after full Chrome restart`, async () => {
    const prefix = encrypted ? 'enc-' : '',
      filename = `separate-recover-${prefix}alternate.mp4`;
    const missing = `/hls/split/${prefix}alternate-1.m4s`;
    fixture.reset();
    fixture.setOutage(missing, true);
    const card = await add(
      filename,
      `split/${prefix}master.m3u8`,
      true,
      `${base}/hls/split/${prefix}alternate.m3u8`,
    );
    await expect(card.getByText('Failed', { exact: true })).toBeVisible({ timeout: 30000 });
    const before = (await jobs()).find((job) => job.filename === filename)!;
    expect(before.segments).toHaveLength(2);
    expect(before.media?.completed).toBe(2);
    await context.close();
    fixture.setOutage(missing, false);
    await launch();
    await page.getByRole('button', { name: `Retry ${filename}`, exact: true }).click();
    const resumed = page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: filename, exact: true }) });
    await expect(resumed.getByText('Ready to save', { exact: true })).toBeVisible();
    const result = (await jobs()).find((job) => job.id === before.id)!;
    expect(result.sha256).toBe(
      (await jobs()).find(
        (job) =>
          job.filename === `hls-playback-${encrypted ? 'aes-' : ''}separate-alternate-mp4.mp4`,
      )?.sha256,
    );
    expect(result.segments.slice(0, 2)).toEqual(before.segments);
    expect(result.media?.audioLabel).toBe(before.media?.audioLabel);
    for (const kind of ['video', 'alternate']) {
      const path = `/hls/split/${prefix}${kind}-0.m4s`;
      expect(
        fixture.stats.methods.filter((item) => item.path === path && item.method === 'GET'),
      ).toHaveLength(1);
      expect(
        fixture.stats.methods.filter((item) => item.path === path && item.method === 'HEAD'),
      ).toHaveLength(1);
    }
  });

test('malformed TS audio fails without committing a part or blocking the next conversion', async () => {
  const card = await add('hls-malformed.mp4', 'ts-bad-vod.m3u8');
  await expect(card.getByText('Failed', { exact: true })).toBeVisible();
  const failed = (await jobs()).find((job) => job.filename === 'hls-malformed.mp4')!;
  expect(failed.error).toContain('Invalid AAC frame length');
  expect(failed.segments).toHaveLength(0);
  expect(failed.sha256).toBeNull();
  const next = await add('hls-after-malformed.mp4', 'ts-vod.m3u8');
  await expect(next.getByText('Ready to save', { exact: true })).toBeVisible();
  expect((await jobs()).find((job) => job.filename === 'hls-after-malformed.mp4')?.sha256).toBe(
    (await jobs()).find((job) => job.filename === 'hls-playback-mpegts.mp4')?.sha256,
  );
});

for (const missing of ['media', 'key', 'audio'] as const)
  test(`an ungranted ${missing} CDN stops before payload fetch and retains committed data`, async () => {
    const key = missing === 'key',
      audio = missing === 'audio';
    // Seed an imported HLS job: only the playlist origin has a fixture grant.
    // The worker must enforce child host permission even without the optional review step.
    const job = createJob(
      {
        url: `${base}/hls/${audio ? 'split/video' : key ? 'aes-cross-key' : 'cross'}.m3u8`,
        media: 'hls',
        filename: `hls-ungranted-${missing}.mp4`,
        ...(audio
          ? {
              audioUrl: `${base.replace('downloads.example.com', 'cdn.example.com')}/hls/split/audio.m3u8`,
            }
          : {}),
      },
      defaultSettings,
    );
    await page.evaluate(async (job) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('flux-downloads', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('jobs', 'readwrite');
        tx.objectStore('jobs').put(job);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, job);
    const path = audio
      ? '/hls/split/video-init.mp4'
      : key
        ? '/hls/aes-init.mp4'
        : '/hls/part-0.m4s';
    const count = fixture.stats.methods.filter((item) => item.path === path).length;
    await page.reload();
    const card = page
      .locator('.download-card')
      .filter({ has: page.getByRole('button', { name: job.filename, exact: true }) });
    await expect(
      card.getByRole('button', { name: `Grant website access for ${job.filename}` }),
    ).toBeVisible();
    const failed = (await jobs()).find((item) => item.id === job.id)!;
    expect(failed.permissionOrigin).toContain('cdn.example.com');
    expect(failed.segments).toHaveLength(key || audio ? 0 : 1);
    expect(fixture.stats.methods.filter((item) => item.path === path)).toHaveLength(count);
  });
test('page media discovery reviews observed HLS playlists instead of downloading the manifest as a video', async () => {
  const site = await context.newPage();
  await site.goto(`${base}/capture-page`);
  await site.evaluate(async () => {
    await (await fetch('/hls/master.m3u8?discovered=1')).text();
  });
  await page.bringToFront();
  const count = (await jobs()).length;
  await page.getByRole('button', { name: 'Find media in active tab', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Media on this page', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review HLS', exact: true }).click();
  await page.getByRole('tab', { name: 'Advanced' }).click();
  await expect(page.getByLabel('Download type')).toHaveValue('hls');
  await expect(page.getByLabel('Download URL')).toHaveValue(`${base}/hls/master.m3u8?discovered=1`);
  expect((await jobs()).length).toBe(count);
  await page.getByRole('button', { name: 'Review HLS playlist', exact: true }).click();
  await expect(page.getByLabel('Video quality')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await site.close();
});
