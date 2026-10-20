import type { Segment, Resource } from '../../domain/model';
export function parseContentRange(value: string | null) {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match) throw new Error('Invalid Content-Range.');
  const [start, end, total] = match.slice(1).map(Number) as [number, number, number];
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end)
    throw new Error('Unsafe Content-Range.');
  return { start, end, total };
}
export function completeBytes(segments: Segment[]) {
  return segments.reduce((sum, s) => sum + s.end - s.start + 1, 0);
}
export function missingRanges(
  total: number,
  completed: Segment[],
  chunkSize: number,
): { start: number; end: number }[] {
  if (!Number.isSafeInteger(total) || total < 0 || chunkSize < 1)
    throw new Error('Unsafe file size.');
  const result: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const segment of [...completed].sort((a, b) => a.start - b.start)) {
    if (segment.start < cursor || segment.end >= total || segment.end < segment.start)
      throw new Error('Overlapping or invalid stored ranges.');
    while (cursor < segment.start) {
      const end = Math.min(segment.start - 1, cursor + chunkSize - 1);
      result.push({ start: cursor, end });
      cursor = end + 1;
    }
    cursor = segment.end + 1;
  }
  while (cursor < total) {
    const end = Math.min(total - 1, cursor + chunkSize - 1);
    result.push({ start: cursor, end });
    cursor = end + 1;
  }
  return result;
}
export function compatibleResource(old: Resource, next: Resource) {
  if (!old.ranges || !next.ranges || old.size !== next.size || old.finalUrl !== next.finalUrl)
    return false;
  if (old.etag && !old.etag.startsWith('W/')) return old.etag === next.etag;
  return !!old.modified && old.modified === next.modified;
}
