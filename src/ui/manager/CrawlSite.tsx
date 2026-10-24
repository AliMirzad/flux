import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../components/Modal';
import type { ManagerAPI } from '../../application/contracts';
import {
  defaultCrawlOptions,
  type CrawlOptions,
  type CrawlProgress,
  type CrawlResult,
} from '../../engine/crawl/site';
import { bytes } from '../components/format';

export function CrawlSite({
  manager,
  onClose,
  onReview,
}: {
  manager: ManagerAPI;
  onClose(): void;
  onReview(text: string, sessionOrigin?: string): void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [progress, setProgress] = useState<CrawlProgress | null>(null),
    [result, setResult] = useState<CrawlResult | null>(null);
  const controller = useRef<AbortController | null>(null),
    sessionOrigin = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      url = String(form.get('url')).trim();
    const options: CrawlOptions = {
      ...defaultCrawlOptions,
      depth: Number(form.get('depth')),
      maxPages: Number(form.get('pages')),
      maxResults: Number(form.get('results')),
      maxBytes: Number(form.get('mib')) * 1024 * 1024,
      delayMs: Math.round(Number(form.get('delay')) * 1000),
      stayInFolder: form.has('folder'),
      includePages: form.has('html'),
      includeAssets: form.has('assets'),
      useBrowserCookies: form.has('cookies'),
    };
    setBusy(true);
    setResult(null);
    setError('');
    setProgress(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const value = await manager.crawlSite(url, options, abort.signal, (value) => {
        if (mounted.current) setProgress(value);
      });
      if (!mounted.current) return;
      sessionOrigin.current = options.useBrowserCookies ? new URL(url).origin : undefined;
      setResult(value);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal title="Crawl a website" onClose={onClose} wide>
      <form className="form-stack" onSubmit={(event) => void scan(event)}>
        <p>
          Find files across linked pages on one website. Pages are read without running their
          scripts. Review and select the results before downloading.
        </p>
        <fieldset
          disabled={busy}
          className="form-stack"
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <label>
            Starting page
            <input
              name="url"
              type="url"
              required
              placeholder="https://example.com/downloads/"
              aria-label="Crawler starting URL"
            />
          </label>
          <div className="grid-two">
            <label>
              Link depth
              <input name="depth" type="number" min={0} max={5} defaultValue={2} required />
            </label>
            <label>
              Maximum pages
              <input name="pages" type="number" min={1} max={100} defaultValue={20} required />
            </label>
            <label>
              Maximum results
              <input name="results" type="number" min={1} max={500} defaultValue={500} required />
            </label>
            <label>
              Scan limit (MiB)
              <input name="mib" type="number" min={1} max={64} defaultValue={20} required />
            </label>
            <label>
              Delay between requests (seconds)
              <input
                name="delay"
                type="number"
                min={0.2}
                max={10}
                step={0.05}
                defaultValue={0.25}
                required
              />
            </label>
          </div>
          <label className="check">
            <input name="folder" type="checkbox" defaultChecked />
            Keep page traversal in the starting folder
          </label>
          <label className="check">
            <input name="assets" type="checkbox" defaultChecked />
            Include embedded images, media, stylesheets and scripts as file candidates
          </label>
          <label className="check">
            <input name="html" type="checkbox" />
            Include HTML pages in the download list
          </label>
          <label className="check">
            <input name="cookies" type="checkbox" />
            Use the starting website's browser session for scanning and selected downloads
          </label>
          <p className="small muted">
            The scan respects robots rules and nofollow links. It follows pages on the starting
            origin only; external file links can be reviewed, but are not fetched during the scan.
            Limits: five levels, 100 pages, 500 results and five minutes. Downloaded HTML remains
            original source; this does not create a rewritten offline website.
          </p>
        </fieldset>
        {progress && (
          <p role="status">
            {progress.pages} pages checked · {bytes(progress.bytes)} scanned · {progress.found}{' '}
            candidates found
          </p>
        )}
        {result && (
          <div className="form-stack">
            <p role="status">
              {result.items.length} candidates ready for review. {result.skipped} references
              skipped.{result.stopped ? ' Scan stopped; partial results retained.' : ''}
              {result.limited ? ' A scan limit was reached.' : ''}
            </p>
            {result.errors.length > 0 && (
              <details>
                <summary>{result.errors.length} pages could not be read</summary>
                <ul>
                  {result.errors.map((item, index) => (
                    <li key={index}>
                      {new URL(item.url).hostname}: {item.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
          {busy ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => controller.current?.abort()}
            >
              Stop and review
            </button>
          ) : (
            <button type="submit" className="button secondary">
              Scan website
            </button>
          )}
          {result && (
            <button
              type="button"
              className="button primary"
              disabled={busy || !result.items.length}
              onClick={() =>
                onReview(
                  JSON.stringify({
                    format: 'flux-download-list',
                    version: 1,
                    items: result.items.map(({ url, filename }) => ({ url, filename })),
                  }),
                  sessionOrigin.current,
                )
              }
            >
              Review found downloads
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
