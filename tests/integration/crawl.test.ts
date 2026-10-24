import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFixture } from '../fixtures/server';
import { crawlSite, defaultCrawlOptions } from '../../src/engine/crawl/site';
import { TrafficLimitError } from '../../src/engine/speed/budget';
let fixture: Awaited<ReturnType<typeof startFixture>>;
beforeAll(async () => {
  fixture = await startFixture();
});
afterAll(async () => {
  await fixture.close();
});
beforeEach(() => fixture.reset());
const network = () => ({ signal: new AbortController().signal, allowLocalForTests: true });
describe('real HTTP site crawling', () => {
  it('charges scanned bytes and stops before another request after the shared allowance expires', async () => {
    let bytes = 0,
      requests = 0;
    const result = await crawlSite(fixture.url + '/crawl/index.html', defaultCrawlOptions, {
      ...network(),
      checkAllowance: async () => {
        if (++requests > 2) throw new TrafficLimitError(Date.now() + 1000);
      },
      consume: async (count) => {
        bytes += count;
      },
    });
    expect(result.limited).toBe(true);
    expect(bytes).toBe(result.bytes);
    expect(fixture.stats.paths).toEqual(['/robots.txt', '/crawl/index.html']);
    expect(result.items.length).toBeGreaterThan(0);
  });
  it('traverses a bounded graph, collects files and respects robots, nofollow, origin and script boundaries', async () => {
    const result = await crawlSite(
      fixture.url + '/crawl/index.html',
      { ...defaultCrawlOptions, delayMs: 200 },
      network(),
    );
    expect(fixture.stats.paths).toContain('/crawl/deep/end.html');
    for (const path of [
      '/crawl/private/blocked.html',
      '/crawl/nofollow.html',
      '/crawl/script.js',
      '/crawl/escaped.html',
      '/external.zip',
    ])
      expect(fixture.stats.paths).not.toContain(path);
    expect(fixture.stats.paths).toContain('/crawl/private/allowed.html');
    expect(result.items.some((item) => item.url.includes('final.bin'))).toBe(true);
    expect(result.items.some((item) => item.url.includes('external.zip'))).toBe(true);
    expect(result.errors.some((item) => item.error.includes('another site'))).toBe(true);
    expect(result.pages).toBeLessThanOrEqual(20);
  });
  it('enforces depth, count, embedded-resource and result limits', async () => {
    const result = await crawlSite(
      fixture.url + '/crawl/index.html',
      { ...defaultCrawlOptions, depth: 0, maxResults: 2, includeAssets: false },
      network(),
    );
    expect(fixture.stats.paths).toEqual(['/robots.txt', '/crawl/index.html']);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.url.includes('.zip'))).toBe(true);
    expect(result.limited).toBe(true);
  });
  it('stops after the byte limit and returns earlier candidates', async () => {
    const result = await crawlSite(
      fixture.url + '/crawl/oversized.html',
      { ...defaultCrawlOptions, maxBytes: 4096 },
      network(),
    );
    expect(result.limited).toBe(true);
    expect(result.errors[0]?.error).toContain('limit');
  });
  it('retains partial results when the user stops and never starts another request', async () => {
    const abort = new AbortController();
    const result = await crawlSite(
      fixture.url + '/crawl/index.html',
      defaultCrawlOptions,
      { ...network(), signal: abort.signal },
      (value) => {
        if (value.pages === 2) abort.abort();
      },
    );
    expect(result.stopped).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(fixture.stats.paths).not.toContain('/crawl/next.html');
  });
  it('fails closed when the site robots policy cannot be read', async () => {
    fixture.setOutage('/robots.txt', true);
    try {
      await expect(
        crawlSite(fixture.url + '/crawl/index.html', defaultCrawlOptions, network()),
      ).rejects.toThrow('503');
    } finally {
      fixture.setOutage('/robots.txt', false);
    }
    expect(fixture.stats.paths).not.toContain('/crawl/index.html');
  });
});
