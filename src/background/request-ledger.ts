import { excludedHost } from '../shared/capture';

/** Ephemeral request metadata only; no cookies, headers with credentials, or persisted URLs. */
export class RequestLedger {
  private requests = new Map<
    string,
    { method: string; at: number; ambiguous: boolean; initiator?: string; tabId?: number }
  >();
  private redirects = new Map<string, { location: string; at: number }>();
  private waiting = new Map<string, Set<(location: string) => void>>();
  constructor(
    private ownOrigin: string,
    private now = () => Date.now(),
  ) {}
  recordRequest(url: string, method: string, initiator?: string, tabId?: number) {
    if (initiator === this.ownOrigin) return;
    this.prune();
    const previous = this.requests.get(url);
    this.requests.set(url, {
      method,
      initiator,
      tabId,
      at: this.now(),
      ambiguous:
        !!previous &&
        (previous.method !== method ||
          previous.initiator !== initiator ||
          previous.tabId !== tabId ||
          previous.ambiguous),
    });
  }
  isRecentGet(url: string, excludedHosts: string[] = []) {
    this.prune();
    const entry = this.requests.get(url);
    if (!entry || entry.method !== 'GET' || entry.ambiguous) return false;
    if (entry.initiator && excludedHosts.length) {
      try {
        if (excludedHost(new URL(entry.initiator).hostname, excludedHosts)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  sourceTab(url: string) {
    this.prune();
    const entry = this.requests.get(url);
    return entry && !entry.ambiguous ? entry.tabId : undefined;
  }
  recordRedirect(url: string, location: string, initiator?: string) {
    if (initiator !== this.ownOrigin) return;
    this.prune();
    this.redirects.set(url, { location, at: this.now() });
    for (const resolve of this.waiting.get(url) ?? []) resolve(location);
  }
  redirect(url: string) {
    this.prune();
    return this.redirects.get(url)?.location;
  }
  prepare(url: string) {
    this.prune();
    this.redirects.delete(url);
  }
  async waitForRedirect(url: string) {
    const existing = this.redirect(url);
    if (existing) return existing;
    return new Promise<string | undefined>((resolve) => {
      const done = (location?: string) => {
        clearTimeout(timer);
        const listeners = this.waiting.get(url);
        listeners?.delete(done);
        if (!listeners?.size) this.waiting.delete(url);
        resolve(location);
      };
      const timer = setTimeout(() => done(), 1000);
      const listeners = this.waiting.get(url) ?? new Set();
      listeners.add(done);
      this.waiting.set(url, listeners);
    });
  }
  private prune() {
    const now = this.now();
    for (const [url, value] of this.requests) if (now - value.at > 30000) this.requests.delete(url);
    for (const [url, value] of this.redirects)
      if (now - value.at > 5000) this.redirects.delete(url);
    while (this.requests.size >= 256) this.requests.delete(this.requests.keys().next().value!);
    while (this.redirects.size >= 256) this.redirects.delete(this.redirects.keys().next().value!);
  }
}
