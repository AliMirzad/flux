import { describe, it, expect } from 'vitest';
import {
  buildNumberPattern,
  parseDownloadList,
  serializeDownloadList,
} from '../../src/application/lists';
import { createJob } from '../../src/application/jobs';

describe('reviewable batch download lists', () => {
  it('excludes received page files and never imports browser-session authorization', () => {
    const page = {
      ...createJob({ url: 'https://example.org/page', useBrowserCookies: true }),
      pageFile: true,
    };
    expect(JSON.parse(serializeDownloadList([page])).items).toEqual([]);
    const input = parseDownloadList(
      JSON.stringify([{ url: page.url, useBrowserCookies: true, pageFile: true }]),
    )[0]!;
    expect(createJob(input).useBrowserCookies).toBe(false);
    expect(createJob(input)).not.toHaveProperty('pageFile');
  });
  it('imports comments, tab-separated names and padded number patterns with URL deduplication', () => {
    const list = parseDownloadList(
      '# archive\nhttps://example.org/file[001:003].zip\nhttps://example.org/file002.zip\nhttps://example.org/manual.pdf\tReport.pdf',
    );
    expect(list.map((item) => item.url)).toEqual([
      'https://example.org/file001.zip',
      'https://example.org/file002.zip',
      'https://example.org/file003.zip',
      'https://example.org/manual.pdf',
    ]);
    expect(list[3]!.filename).toBe('Report.pdf');
  });
  it('round-trips explicit metadata without trusting exported completion/checkpoints', () => {
    const job = createJob({
      url: 'https://example.org/file?token=local',
      filename: 'safe.zip',
      expectedHash: 'a'.repeat(64),
      speedLimit: 5000,
    });
    job.state = 'COMPLETED';
    const items = parseDownloadList(serializeDownloadList([job]));
    expect(items[0]).toMatchObject({
      url: job.url,
      filename: 'safe.zip',
      expectedHash: 'a'.repeat(64),
      speedLimit: 5000,
    });
    expect(items[0]).not.toHaveProperty('state');
    expect(items[0]).not.toHaveProperty('segments');
  });
  it('rejects unsafe URLs, invalid metadata, excessive patterns and oversized lists before import', () => {
    for (const text of [
      'http://127.0.0.1/private',
      'https://user:password@example.org/file',
      'https://example.org/[1:501].zip',
      'https://example.org/[5:1].zip',
      JSON.stringify([{ url: 'https://example.org/a', expectedHash: 'wrong' }]),
      JSON.stringify({
        format: 'flux-download-list',
        version: 5,
        items: [{ url: 'https://example.org/a' }],
      }),
      JSON.stringify({ format: 'other-format', version: 1, items: [] }),
    ])
      expect(() => parseDownloadList(text)).toThrow();
    expect(() => parseDownloadList(' '.repeat(2 * 1024 * 1024 + 1))).toThrow(/2 MiB/);
  });
  it('round-trips HLS type using version 2 without restoring byte or retry state', () => {
    const job = createJob({ url: 'https://example.org/video.m3u8', media: 'hls' });
    job.media!.planHash = 'a'.repeat(64);
    const text = serializeDownloadList([job]);
    expect(JSON.parse(text).version).toBe(2);
    const imported = parseDownloadList(text)[0]!;
    expect(imported.media).toBe('hls');
    expect(imported).not.toHaveProperty('planHash');
    expect(createJob(imported).media).toEqual({ kind: 'hls' });
  });
  it('round-trips DASH selections and recording limits in version 4 without checkpoints or consent', () => {
    const jobs = [
      ...['en', 'fa'].map((audioId) =>
        createJob({
          url: 'https://example.org/video.mpd',
          media: 'dash',
          dash: { videoId: 'video-720', audioId },
          useBrowserCookies: true,
        }),
      ),
      createJob({ url: 'https://example.org/live.m3u8', media: 'hls', recordingSeconds: 120 }),
    ];
    jobs[2]!.media!.recording!.snapshot = 'private durable plan';
    const serialized = serializeDownloadList(jobs);
    expect(JSON.parse(serialized).version).toBe(4);
    const imported = parseDownloadList(serialized).map((input) => createJob(input));
    expect(imported).toHaveLength(3);
    expect(imported.slice(0, 2).map((job) => job.media!.dash!.audioId)).toEqual(['en', 'fa']);
    expect(imported[2]!.media!.recording).toEqual({ maxSeconds: 120 });
    expect(imported.every((job) => job.useBrowserCookies === false)).toBe(true);
    expect(serialized).not.toContain('private durable plan');
  });
  it('round-trips two audio choices for the same video in version 3 without merging them', () => {
    const jobs = ['en', 'fa'].map((language) =>
      createJob({
        url: 'https://example.org/video.m3u8',
        media: 'hls',
        audioUrl: `https://example.org/${language}.m3u8`,
        audioLabel: language,
      }),
    );
    const text = serializeDownloadList(jobs);
    expect(JSON.parse(text).version).toBe(3);
    const inputs = parseDownloadList(text);
    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => createJob(input).media?.audioUrl)).toEqual(
      jobs.map((job) => job.media?.audioUrl),
    );
    expect(() =>
      createJob({
        url: 'https://example.org/video.m3u8',
        media: 'hls',
        audioUrl: 'http://example.org/audio.m3u8',
      }),
    ).toThrow(/insecure/);
    expect(() =>
      createJob({ url: 'https://example.org/file', audioUrl: 'https://example.org/audio.m3u8' }),
    ).toThrow(/HLS/);
  });
});

describe('numbered series pattern', () => {
  it('builds a padded pattern from a sample link and the last number', () => {
    expect(buildNumberPattern('https://example.org/v1/video-01.mp4', 12)).toBe(
      'https://example.org/v1/video-[01:12].mp4',
    );
    expect(buildNumberPattern('https://example.org/part7.zip', 100)).toBe(
      'https://example.org/part[007:100].zip',
    );
    expect(() => buildNumberPattern('https://example.org/file.zip', 5)).toThrow();
    expect(() => buildNumberPattern('https://example.org/file-10.zip', 5)).toThrow();
  });
});
