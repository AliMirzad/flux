import { describe, it, expect } from 'vitest';
import {
  createBrowserJob,
  updateBrowserJob,
  browserReference,
  browserNeedsReview,
} from '../../src/domain/browser-download';
import { serializeDownloadList } from '../../src/application/lists';
import { percent } from '../../src/ui/components/format';
function item(patch: Partial<chrome.downloads.DownloadItem> = {}): chrome.downloads.DownloadItem {
  return {
    id: 10,
    url: 'https://example.org/file.zip',
    finalUrl: 'https://example.org/file.zip',
    referrer: 'https://example.org/page',
    filename: 'C:\\Downloads\\file.zip',
    danger: 'safe',
    mime: 'application/zip',
    startTime: '2026-10-20T10:00:00.000Z',
    state: 'in_progress',
    paused: false,
    canResume: false,
    bytesReceived: 200,
    totalBytes: 1000,
    fileSize: -1,
    exists: true,
    incognito: false,
    ...patch,
  };
}
describe('original browser transfer records', () => {
  it('preserves the original identity and maps completion without inventing OPFS hashes or segments', () => {
    const first = createBrowserJob(item());
    expect(first.engine).toBe('browser');
    expect(first.filename).toBe('file.zip');
    expect(first.browser).toMatchObject({ id: 10, startedAt: item().startTime });
    const done = updateBrowserJob(
      { ...first, sha256: 'a'.repeat(64) },
      item({ state: 'complete', bytesReceived: 1000, fileSize: 1000 }),
    );
    expect(done.state).toBe('COMPLETED');
    expect(done.exported).toBe(true);
    expect(done.sha256).toBeNull();
    expect(done.segments).toEqual([]);
    expect(() => updateBrowserJob(first, item({ startTime: '2027-01-01T00:00:00Z' }))).toThrow(
      /identity/,
    );
    expect(() => updateBrowserJob(first, item({ id: 99 }))).toThrow(/identity/);
  });
  it('keeps security review and original-request interruption distinct from transport replay', () => {
    const first = createBrowserJob(item({ paused: true, canResume: true }));
    expect(first.state).toBe('PAUSED');
    expect(updateBrowserJob(first, item({ danger: 'uncommon' })).state).toBe('PAUSED');
    expect(browserNeedsReview('uncommon')).toBe(true);
    expect(browserNeedsReview('safe')).toBe(false);
    const interrupted = updateBrowserJob(
      first,
      item({ state: 'interrupted', error: 'NETWORK_FAILED', canResume: false }),
    );
    expect(interrupted.state).toBe('FAILED');
    expect(interrupted.error).toContain('NETWORK_FAILED');
    expect(
      updateBrowserJob(first, item({ state: 'interrupted', error: 'USER_CANCELED' })).state,
    ).toBe('CANCELED');
  });
  it('never stores data URL payloads, exports unusable generated addresses, or admits private source references', () => {
    const generated = createBrowserJob(
      item({
        url: 'data:application/octet-stream;base64,c2VjcmV0',
        finalUrl: 'data:application/octet-stream;base64,c2VjcmV0',
      }),
    );
    expect(generated.browser?.sourceKind).toBe('data');
    expect(JSON.stringify(generated)).not.toContain('c2VjcmV0');
    const blob = createBrowserJob(
      item({ url: 'blob:https://example.org/uuid', finalUrl: 'blob:https://example.org/uuid' }),
    );
    expect(blob.browser?.sourceKind).toBe('blob');
    expect(JSON.parse(serializeDownloadList([generated, blob])).items).toEqual([]);
    expect(() => browserReference(item({ url: 'blob:http://127.0.0.1/id', finalUrl: '' }))).toThrow(
      /private/,
    );
    expect(() =>
      browserReference(item({ url: 'data:text/plain,test', finalUrl: '', referrer: '' })),
    ).toThrow();
  });
  it('shows completed empty files as complete and keeps an expected digest explicitly unverified', () => {
    const empty = createBrowserJob(
      item({ state: 'complete', bytesReceived: 0, totalBytes: 0, fileSize: 0 }),
    );
    expect(percent(empty)).toBe(100);
    expect(
      updateBrowserJob({ ...empty, expectedHash: 'a'.repeat(64) }, item({ state: 'complete' }))
        .note,
    ).toContain('has not been verified');
  });
});
