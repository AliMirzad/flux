export function validateUrl(input: string, allowLocalForTests = false): URL {
  if (input.length > 16384) throw new Error('URL is too long.');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a complete HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Only HTTP(S) URLs without embedded credentials are supported.');
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  const parts = host.split('.').map(Number);
  const privateV4 =
    parts.length === 4 &&
    parts.every(Number.isInteger) &&
    (parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) ||
      (parts[0] === 192 && parts[1] === 88 && parts[2] === 99) ||
      (parts[0] === 198 &&
        (parts[1] === 18 || parts[1] === 19 || (parts[1] === 51 && parts[2] === 100))) ||
      (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
      (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) ||
      parts[0]! >= 224);
  // IPv6 literals are deliberately refused: this also blocks mapped private IPv4.
  if (
    !allowLocalForTests &&
    (privateV4 ||
      host.includes(':') ||
      !host.includes('.') ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.test') ||
      host.endsWith('.home.arpa'))
  )
    throw new Error(
      'Local and private network addresses are blocked. Use Chrome’s normal downloader for these files.',
    );
  url.hash = '';
  return url;
}
export function originPattern(url: string) {
  return `${validateUrl(url).origin}/*`;
}
export function safeError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'Chrome storage or disk space is full. Verified data is retained. Free space, clean temporary downloads, or choose another download folder, then save again.';
  const message = error instanceof Error ? error.message : 'Operation failed.';
  return message.replace(/https?:\/\/[^\s)]+/g, '[URL hidden]').slice(0, 350);
}
export function trustedSender(sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || typeof sender.url !== 'string') return false;
  try {
    const parsed = new URL(sender.url);
    return (
      parsed.protocol === 'chrome-extension:' &&
      parsed.host === chrome.runtime.id &&
      ['/manager.html', '/popup.html'].includes(parsed.pathname)
    );
  } catch {
    return false;
  }
}
