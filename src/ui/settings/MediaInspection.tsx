import { useEffect, useRef, useState, type FormEvent } from 'react';
import { inspectCompanion, type CompanionReview } from '../../application/companion';

export function MediaInspection() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<CompanionReview | null>(null);
  const [selection, setSelection] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(
      () => {
        active.current?.abort();
        setReview(null);
        setError('This media review expired. Inspect again to refresh it.');
      },
      Math.max(0, review.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [review]);

  async function inspect(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setReview(null);
    setError('');
    try {
      if (!globalThis.chrome?.runtime?.id)
        throw new Error('Open the installed Flux extension to inspect media.');
      const granted = await chrome.permissions.request({ permissions: ['nativeMessaging'] });
      if (!granted) throw new Error('Companion access was declined. You can try again when ready.');
      if (controller.signal.aborted) return;
      await navigator.locks.request(
        'flux-companion-session',
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              'Another Flux tab is using the companion. Close its review or try again shortly.',
            );
          const value = await inspectCompanion(chrome.runtime, url, controller.signal, () => {
            setReview(null);
            setError('The companion disconnected. Inspect again to refresh the review.');
            controller.abort();
          });
          if (controller.signal.aborted) return;
          setReview(value);
          setSelection(value.formats[0]!.selectionId);
          setBusy(false);
          // Keep ownership while the review is displayed. Closing the view or
          // starting another review releases both the native port and this lock.
          await new Promise<void>((resolve) => {
            if (controller.signal.aborted) resolve();
            else controller.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        },
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Media inspection failed.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  function close() {
    active.current?.abort();
    setBusy(false);
    setReview(null);
    setError('');
  }

  return (
    <section className="storage-settings panel">
      <div>
        <h3>Inspect media</h3>
        <p>Review available formats through the companion. Download support comes next.</p>
      </div>
      <form className="form-stack" onSubmit={(event) => void inspect(event)}>
        <label>
          Media URL
          <input
            type="url"
            required
            maxLength={8192}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={busy}
            placeholder="https://example.com/watch"
          />
        </label>
        <div className="toolbar">
          <button className="button secondary" disabled={busy}>
            {busy ? 'Inspecting media…' : 'Inspect media'}
          </button>
          {(busy || review) && (
            <button type="button" className="button secondary" onClick={close}>
              {busy ? 'Cancel inspection' : 'Close review'}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {review && (
          <div className="form-stack" aria-label="Media review">
            <p role="status">{review.title}</p>
            <p className="small muted">
              {review.duration === null
                ? 'Duration unavailable'
                : `${Math.round(review.duration)} seconds`}
              {' · '}Review expires at {new Date(review.expiresAt).toLocaleTimeString()}.
            </p>
            <label>
              Available format
              <select
                aria-label="Available format"
                value={selection}
                onChange={(event) => setSelection(event.target.value)}
              >
                {review.formats.map((format) => (
                  <option key={format.selectionId} value={format.selectionId}>
                    {format.label}
                  </option>
                ))}
              </select>
            </label>
            {review.truncated && (
              <p className="small muted">Showing the first 200 available formats.</p>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
