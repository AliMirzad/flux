import { describe, it, expect } from 'vitest';
import { parseDownloadList, serializeDownloadList } from '../../src/application/lists';
import { createJob } from '../../src/application/jobs';

describe('reviewable batch download lists', () => {
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
    ])
      expect(() => parseDownloadList(text)).toThrow();
    expect(() => parseDownloadList(' '.repeat(2 * 1024 * 1024 + 1))).toThrow(/2 MiB/);
  });
});
