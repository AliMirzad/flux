import { describe, expect, it } from 'vitest';
import {
  completeBytes,
  compatibleResource,
  missingRanges,
  parseContentRange,
} from '../../src/engine/segmentation/ranges';
import type { Resource, Segment } from '../../src/domain/model';

describe('byte ranges', () => {
  it('validates every bound and safe numeric representation', () => {
    expect(parseContentRange('bytes 0-0/100')).toEqual({ start: 0, end: 0, total: 100 });
    for (const value of [
      null,
      'bytes */100',
      'bytes 0-100/100',
      'bytes 2-1/3',
      'bytes 0-1/*',
      'bytes -1-2/3',
      'items 0-1/3',
      'bytes 0-1/9007199254740992',
    ]) {
      expect(() => parseContentRange(value)).toThrow();
    }
  });
  it('allocates holes exactly once without crossing committed ranges', () => {
    const completed: Segment[] = [
      { start: 8, end: 11, hash: '' },
      { start: 0, end: 2, hash: '' },
    ];
    expect(missingRanges(16, completed, 3)).toEqual([
      { start: 3, end: 5 },
      { start: 6, end: 7 },
      { start: 12, end: 14 },
      { start: 15, end: 15 },
    ]);
    expect(completeBytes(completed)).toBe(7);
    expect(missingRanges(0, [], 4)).toEqual([]);
  });
  it('covers generated sparse files with no gaps or duplicate bytes', () => {
    for (let total = 1; total < 200; total += 7) {
      const completed = Array.from({ length: total }, (_, i) => i)
        .filter((i) => i % 5 === 0)
        .map((i) => ({ start: i, end: i, hash: '' }));
      const all = [...completed, ...missingRanges(total, completed, 9)].sort(
        (a, b) => a.start - b.start,
      );
      let cursor = 0;
      for (const range of all) {
        expect(range.start).toBe(cursor);
        cursor = range.end + 1;
      }
      expect(cursor).toBe(total);
    }
  });
  it('rejects overlapping or out-of-file checkpoints', () => {
    for (const completed of [
      [
        { start: 0, end: 2 },
        { start: 2, end: 3 },
      ],
      [{ start: 0, end: 10 }],
      [{ start: 2, end: 1 }],
    ]) {
      expect(() =>
        missingRanges(
          10,
          completed.map((s) => ({ ...s, hash: '' })),
          2,
        ),
      ).toThrow();
    }
  });
});

describe('resource identity for resume', () => {
  const original: Resource = {
    finalUrl: 'https://example.org/file',
    size: 100,
    ranges: true,
    etag: '"v1"',
    modified: 'Mon, 01 Jan 2024 00:00:00 GMT',
    mime: 'application/octet-stream',
    filename: 'file',
  };
  it('requires a stable strong validator and unchanged size / URL', () => {
    expect(compatibleResource(original, { ...original })).toBe(true);
    for (const changed of [
      { etag: '"v2"' },
      { size: 101 },
      { ranges: false },
      { finalUrl: 'https://other.org/file' },
    ]) {
      expect(compatibleResource(original, { ...original, ...changed })).toBe(false);
    }
  });
  it('uses last-modified for weak ETags, refusing unvalidated content', () => {
    expect(
      compatibleResource({ ...original, etag: 'W/"v1"' }, { ...original, etag: 'W/"v2"' }),
    ).toBe(true);
    expect(
      compatibleResource(
        { ...original, etag: null, modified: null },
        { ...original, etag: null, modified: null },
      ),
    ).toBe(false);
    expect(
      compatibleResource(
        { ...original, etag: null },
        { ...original, etag: null, modified: 'different' },
      ),
    ).toBe(false);
  });
});
