import type { Category, Settings } from '../domain/model';
export function sanitizeFilename(input: string): string {
  const name = input
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 180);
  return !name
    ? 'download'
    : /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)
      ? `_${name}`
      : name;
}
export function filenameFromHeaders(disposition: string | null, url: string) {
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  let name =
    encoded ?? plain?.[1] ?? plain?.[2] ?? new URL(url).pathname.split('/').pop() ?? 'download';
  try {
    name = decodeURIComponent(name);
  } catch {
    /* Malformed server encoding is kept as text. */
  }
  return sanitizeFilename(name);
}
export function categoryOf(name: string): Category {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx', 'pptx', 'epub'].includes(ext))
    return 'Documents';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'bz2'].includes(ext)) return 'Archives';
  if (['mp4', 'webm', 'mkv', 'mov', 'avi'].includes(ext)) return 'Videos';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return 'Audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return 'Images';
  if (['exe', 'msi', 'dmg', 'pkg', 'iso', 'deb', 'rpm', 'apk'].includes(ext)) return 'Software';
  return 'Other';
}
/** Relative folder segments, each sanitized; "..", "." and empty parts are dropped. */
export function folderSegments(path: string) {
  return path
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map(sanitizeFilename)
    .slice(0, 8);
}
export function categoryFolderName(
  category: Category,
  settings: Pick<Settings, 'categoryFolders'>,
) {
  return folderSegments(settings.categoryFolders?.[category] || category).join('/') || category;
}
/** Path relative to Chrome's Downloads folder, as accepted by chrome.downloads. */
export function downloadsRelativePath(
  filename: string,
  settings: Pick<Settings, 'downloadsSubfolder' | 'saveByCategory' | 'categoryFolders'>,
) {
  const name = sanitizeFilename(filename);
  return [
    ...folderSegments(settings.downloadsSubfolder ?? ''),
    ...(settings.saveByCategory ? [categoryFolderName(categoryOf(name), settings)] : []),
    name,
  ].join('/');
}
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}
