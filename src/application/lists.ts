import type { DownloadJob, NewDownload } from '../domain/model';
import { validateUrl } from '../shared/security';
import { createJob, downloadIdentity } from './jobs';

export function parseDownloadList(text: string): NewDownload[] {
  if (text.length > 2 * 1024 * 1024) throw new Error('Download lists must be smaller than 2 MiB.');
  const source = text.trim();
  if (!source) return [];
  let values: unknown[];
  if (source.startsWith('[') || source.startsWith('{')) {
    const parsed: unknown = JSON.parse(source);
    if (!Array.isArray(parsed)) {
      const envelope = parsed as { format?: unknown; version?: unknown } | null;
      if (envelope?.format !== undefined && envelope.format !== 'flux-download-list')
        throw new Error('Unsupported download list format.');
      if (envelope?.version !== undefined && ![1, 2, 3].includes(envelope.version as number))
        throw new Error('This download list requires a supported format version.');
    }
    values = Array.isArray(parsed) ? parsed : (parsed as { items: unknown[] })?.items;
    if (!Array.isArray(values)) throw new Error('The list must contain an items array.');
  } else
    values = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  const inputs: NewDownload[] = [];
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (typeof value !== 'string' && (!value || typeof value !== 'object'))
      throw new Error(`Invalid item ${index + 1}.`);
    const item =
      typeof value === 'string'
        ? { url: value.split('\t')[0]!, filename: value.split('\t')[1] }
        : (value as NewDownload);
    if (typeof item.url !== 'string') throw new Error(`Item ${index + 1} needs a URL.`);
    const pattern = item.url.match(/\[(\d+):(\d+)\]/);
    const first = pattern ? Number(pattern[1]) : 0;
    const last = pattern ? Number(pattern[2]) : 0;
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      last < first ||
      last - first >= 500
    )
      throw new Error('A batch pattern may expand to at most 500 URLs.');
    for (let number = first; number <= last; number++) {
      const rawUrl = pattern
        ? item.url.replace(pattern[0], String(number).padStart(pattern[1]!.length, '0'))
        : item.url;
      const url = validateUrl(rawUrl).href;
      const input: NewDownload = {
        url,
        filename: item.filename,
        priority: item.priority,
        scheduledAt: item.scheduledAt,
        speedLimit: item.speedLimit,
        expectedHash: item.expectedHash,
        media: item.media,
        audioUrl: item.audioUrl,
        audioLabel: item.audioLabel,
      };
      const validated = createJob(input); // Validate metadata before committing any entry or requesting permission.
      const identity = downloadIdentity(validated.url, validated.media?.audioUrl);
      if (seen.has(identity)) continue;
      seen.add(identity);
      inputs.push(input);
      if (inputs.length > 500) throw new Error('Import at most 500 downloads at once.');
    }
  }
  return inputs;
}

/** Turns a sample link and a last number into a `[first:last]` pattern on the final number in the link. */
export function buildNumberPattern(sample: string, last: number): string {
  const link = sample.trim();
  const nameStart = link.lastIndexOf('/') + 1;
  const dot = link.lastIndexOf('.');
  const nameEnd = dot > nameStart ? dot : link.length; // Digits in the extension (.mp4) are not the series number.
  const match = [...link.matchAll(/\d+/g)]
    .filter((item) => item.index >= nameStart && item.index < nameEnd)
    .pop();
  if (!match) throw new Error('The link needs a number in the file name, such as file-001.zip.');
  if (!Number.isSafeInteger(last) || last < Number(match[0]))
    throw new Error(`Enter a last number of ${match[0]} or higher.`);
  const width = Math.max(match[0].length, String(last).length);
  const first = match[0].padStart(width, '0');
  return `${link.slice(0, match.index)}[${first}:${String(last).padStart(width, '0')}]${link.slice(match.index + match[0].length)}`;
}

export function serializeDownloadList(jobs: DownloadJob[]) {
  return JSON.stringify(
    {
      format: 'flux-download-list',
      version: jobs.some((job) => job.media?.audioUrl) ? 3 : jobs.some((job) => job.media) ? 2 : 1,
      items: jobs
        .filter(
          (job) =>
            !job.pageFile && (job.engine !== 'browser' || job.browser?.sourceKind === 'http'),
        )
        .map((job) => ({
          url: job.url,
          media: job.media?.kind,
          audioUrl: job.media?.audioUrl,
          audioLabel: job.media?.audioLabel,
          filename: job.filename,
          priority: job.priority,
          speedLimit: job.speedLimit,
          expectedHash: job.expectedHash ?? undefined,
          scheduledAt: job.scheduledAt,
        })),
    },
    null,
    2,
  );
}
