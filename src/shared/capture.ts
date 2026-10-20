import type { Settings } from '../domain/model';
import { validateUrl } from './security';
export const captureOrigins = ['http://*/*', 'https://*/*'];
export function excludedHost(host: string, exclusions: string[]) {
  return exclusions.some((value) => {
    const blocked = value.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
    return !!blocked && (host === blocked || host.endsWith('.' + blocked));
  });
}
export function eligibleLink(
  url: string,
  settings: Pick<Settings, 'fileExtensions' | 'excludedHosts'>,
  explicitDownload = false,
) {
  let parsed: URL;
  try {
    parsed = validateUrl(url);
  } catch {
    return false;
  }
  if (excludedHost(parsed.hostname, settings.excludedHosts)) return false;
  if (explicitDownload) return true;
  const candidates = [
    parsed.pathname,
    ...['filename', 'file', 'name', 'download'].map((key) => parsed.searchParams.get(key) ?? ''),
  ];
  return candidates.some((value) => {
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {}
    const extension = decoded.split('/').pop()?.split('.').pop()?.toLowerCase();
    return !!extension && settings.fileExtensions.includes(extension);
  });
}
