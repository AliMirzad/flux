import { describe, expect, it } from 'vitest';
import { robotsPolicy } from '../../src/engine/crawl/robots';
import {
  defaultCrawlOptions,
  pageReferences,
  validateCrawlOptions,
} from '../../src/engine/crawl/site';
describe('crawler page and robots interpretation', () => {
  it('reads links, bases and media without constructing a browser document or running scripts', () => {
    const result = pageReferences(
      '<base href="/assets/"><a href="next.html">Page</a><a download="file.zip" href="download">File</a><img src="picture.png"><script>throw new Error("No execution")</script><script src="script.js"></script><template><a href="inactive.html">Hidden</a></template><a href="http://127.0.0.1/private">Private</a>',
      'https://example.org/start/index.html',
    );
    expect(result.references.map((item) => item.url)).toEqual([
      'https://example.org/assets/next.html',
      'https://example.org/assets/download',
      'https://example.org/assets/picture.png',
      'https://example.org/assets/script.js',
    ]);
    expect(result.references[1]).toMatchObject({
      page: false,
      filename: 'file.zip',
      embedded: false,
    });
    expect(result.skipped).toBe(1);
  });
  it('honors page/link nofollow and refuses credentials, private addresses and downgrades', () => {
    const result = pageReferences(
      '<meta name="robots" content="nofollow"><a href="child.html">Child</a><a href="https://user:pass@example.org/file">Auth</a><img src="http://example.org/downgrade.png"><a href="/logout">Logout</a>',
      'https://example.org/',
    );
    expect(result.references.every((item) => !item.follow)).toBe(true);
    expect(result.skipped).toBe(2);
    expect(() => pageReferences('<a>'.repeat(32769), 'https://example.org')).toThrow(/bound/);
  });
  it('combines matching product groups, prefers them over wildcard groups and resolves longest rules', () => {
    const allow = robotsPolicy(
      'User-agent: *\nDisallow: /\nUser-agent: Flux\nDisallow: /private/\nAllow: /private/read\nUser-agent: flux\nDisallow: /*.zip$\nAllow: /public.zip$',
    );
    expect(allow('/index.html')).toBe(true);
    expect(allow('/private/write')).toBe(false);
    expect(allow('/private/read')).toBe(true);
    expect(allow('/archive.zip')).toBe(false);
    expect(allow('/archive.zip?x=1')).toBe(true);
    expect(allow('/public.zip')).toBe(true);
  });
  it('compares percent encodings, UTF-8 and allow ties without regex backtracking', () => {
    const allow = robotsPolicy(
      'User-agent: *\nDisallow: /%7Eprivate\nDisallow: /café\nDisallow: /a%2Fb\nDisallow: /same\nAllow: /same',
    );
    expect(allow('/~private')).toBe(false);
    expect(allow('/caf%C3%A9')).toBe(false);
    expect(allow('/a%2fb')).toBe(false);
    expect(allow('/a/b')).toBe(true);
    expect(allow('/same')).toBe(true);
    const excessive = robotsPolicy('User-agent: *\nDisallow: /*' + 'a'.repeat(1000) + 'b');
    expect(() => excessive('/' + 'a'.repeat(16000))).toThrow(/work limit/);
  });
  it('bounds every user-supplied traversal limit before fetching', () => {
    for (const patch of [
      { depth: 6 },
      { maxPages: 101 },
      { maxResults: 501 },
      { maxBytes: 1023 },
      { delayMs: 0 },
      { includeAssets: 'yes' },
    ])
      expect(() =>
        validateCrawlOptions({ ...defaultCrawlOptions, ...patch } as typeof defaultCrawlOptions),
      ).toThrow();
  });
});
