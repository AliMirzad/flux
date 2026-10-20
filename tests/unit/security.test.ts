import { describe, expect, it } from 'vitest';
import { categoryOf, filenameFromHeaders, sanitizeFilename } from '../../src/shared/files';
import { safeError, validateUrl } from '../../src/shared/security';

describe('untrusted URLs', () => {
  it('allows HTTP(S) while removing fragments', () => {
    expect(validateUrl('https://example.org/file#secret').href).toBe('https://example.org/file');
    expect(validateUrl('http://127.0.0.1:8080/file', true).hostname).toBe('127.0.0.1');
  });
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,test',
    'https://user:pass@example.org',
    'http://localhost/f',
    'http://127.1/f',
    'http://0x7f000001/f',
    'http://10.0.0.1/f',
    'http://172.16.1.1/f',
    'http://192.168.1.1/f',
    'http://169.254.169.254/f',
    'http://100.64.0.1/f',
    'http://[::1]/f',
    'http://[::ffff:127.0.0.1]/f',
    'https://intranet/f',
    'https://printer.local/f',
    'https://host.internal/f',
  ])('rejects unsafe target %s', (url) => expect(() => validateUrl(url)).toThrow());
  it('redacts signed URLs from diagnostics', () => {
    const message = safeError(
      new Error('Download https://example.org/private?token=secret failed.'),
    );
    expect(message).not.toContain('secret');
    expect(message).toContain('[URL hidden]');
  });
});

describe('filenames', () => {
  it.each([
    '../../escape.exe',
    '..\\..\\escape.exe',
    'CON',
    'lpt1.txt',
    'nul',
    'a\u202eb.exe',
    'a\u0000b',
    '  ...  ',
    'name. ',
  ])('sanitizes untrusted filename %s', (value) => {
    const name = sanitizeFilename(value);
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(181);
    expect(name).not.toMatch(/[\\/<>:"|?*\u0000-\u001f\u202a-\u202e]/);
    expect(name).not.toMatch(/^[. ]|[. ]$/);
    expect(name).not.toMatch(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i);
  });
  it('prefers Unicode filename* and safely tolerates malformed server encoding', () => {
    expect(
      filenameFromHeaders(
        'attachment; filename="fallback.bin"; filename*=UTF-8\'\'%E2%9C%93.zip',
        'https://example.org/file',
      ),
    ).toBe('✓.zip');
    expect(
      filenameFromHeaders('attachment; filename="bad%zz.bin"', 'https://example.org/file'),
    ).toBe('bad%zz.bin');
    expect(filenameFromHeaders(null, 'https://example.org/%E2%9C%93.txt')).toBe('✓.txt');
    expect(categoryOf('Report.PDF')).toBe('Documents');
    expect(categoryOf('payload.zip')).toBe('Archives');
  });
});
