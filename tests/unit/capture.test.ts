import { describe, it, expect, vi } from 'vitest';
import { eligibleLink, excludedHost } from '../../src/shared/capture';
import { RequestLedger } from '../../src/background/request-ledger';
const settings = { fileExtensions: ['zip', 'pdf'], excludedHosts: ['blocked.example.com'] };
describe('automatic capture policy', () => {
  it('handles cross-origin filenames, signed URL names and explicit download attributes', () => {
    expect(eligibleLink('https://cdn.example.com/file.ZIP?token=secret', settings)).toBe(true);
    expect(eligibleLink('https://cdn.example.com/get?filename=report.pdf', settings)).toBe(true);
    expect(eligibleLink('https://cdn.example.com/endpoint', settings, true)).toBe(true);
    expect(eligibleLink('https://cdn.example.com/page', settings)).toBe(false);
    expect(eligibleLink('https://child.blocked.example.com/file.zip', settings)).toBe(false);
    expect(eligibleLink('http://127.0.0.1/file.zip', settings, true)).toBe(false);
    expect(eligibleLink('blob:https://cdn.example.com/abc', settings, true)).toBe(false);
    expect(excludedHost('notblocked.example.com', ['blocked.example.com'])).toBe(false);
  });
  it('never treats a known POST, ambiguous method, stale request, or own probe as a transferable GET', () => {
    let now = 0;
    const ledger = new RequestLedger('chrome-extension://flux', () => now);
    ledger.recordRequest('https://example.com/a', 'GET', 'https://site.com');
    expect(ledger.isRecentGet('https://example.com/a')).toBe(true);
    ledger.recordRequest('https://example.com/a', 'POST', 'https://site.com');
    expect(ledger.isRecentGet('https://example.com/a')).toBe(false);
    ledger.recordRequest('https://example.com/a', 'GET', 'https://site.com');
    expect(ledger.isRecentGet('https://example.com/a')).toBe(false);
    ledger.recordRequest('https://example.com/probe', 'GET', 'chrome-extension://flux');
    expect(ledger.isRecentGet('https://example.com/probe')).toBe(false);
    now = 31000;
    expect(ledger.isRecentGet('https://example.com/a')).toBe(false);
  });
  it('uses only extension-owned redirect responses and expires metadata', async () => {
    let now = 0;
    const ledger = new RequestLedger('chrome-extension://flux', () => now);
    ledger.recordRedirect('https://example.com/a', 'https://attacker.com', 'https://site.com');
    expect(ledger.redirect('https://example.com/a')).toBeUndefined();
    const pending = ledger.waitForRedirect('https://example.com/a');
    ledger.recordRedirect('https://example.com/a', '/final', 'chrome-extension://flux');
    expect(await pending).toBe('/final');
    now = 6000;
    expect(ledger.redirect('https://example.com/a')).toBeUndefined();
  });
  it('preserves downloads initiated by excluded sites and refuses ambiguous sources', () => {
    const ledger = new RequestLedger('chrome-extension://flux');
    const url = 'https://cdn.example.com/file.zip';
    ledger.recordRequest(url, 'GET', 'https://child.blocked.example.com');
    expect(ledger.isRecentGet(url, ['blocked.example.com'])).toBe(false);
    expect(ledger.isRecentGet(url, ['unrelated.example.com'])).toBe(true);
    ledger.recordRequest(url, 'GET', 'https://different.example.com');
    expect(ledger.isRecentGet(url)).toBe(false);
    const tabbed = 'https://cdn.example.com/tabbed.zip';
    ledger.recordRequest(tabbed, 'GET', 'https://site.example.com', 12);
    expect(ledger.sourceTab(tabbed)).toBe(12);
    ledger.recordRequest(tabbed, 'GET', 'https://site.example.com', 13);
    expect(ledger.isRecentGet(tabbed)).toBe(false);
    expect(ledger.sourceTab(tabbed)).toBeUndefined();
  });
});
