import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  inspectCompanion,
  listCompanionDestinations,
  type CompanionDestination,
  type CompanionReview,
} from '../../application/companion';

export function MediaInspection() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<CompanionReview | null>(null);
  const [selection, setSelection] = useState('');
  const [folders, setFolders] = useState<CompanionDestination[]>([]);
  const [folder, setFolder] = useState('');
  const [foldersChecked, setFoldersChecked] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState('');
  const folderRequest = useRef<AbortController | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      folderRequest.current?.abort();
    },
    [],
  );
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
    if (busy || folderRequest.current) return;
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

  async function refreshFolders() {
    if (folderRequest.current || busy || review) return;
    const controller = new AbortController();
    folderRequest.current = controller;
    setFolderBusy(true);
    setFolderError('');
    setFoldersChecked(false);
    setFolders([]);
    setFolder('');
    try {
      if (!globalThis.chrome?.runtime?.id)
        throw new Error('Open the installed Flux extension first.');
      const granted = await chrome.permissions.request({ permissions: ['nativeMessaging'] });
      if (!granted) throw new Error('Companion access was declined. You can try again when ready.');
      if (controller.signal.aborted) return;
      await navigator.locks.request(
        'flux-companion-session',
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error('Another Flux tab is using the companion. Close its review first.');
          const value = await listCompanionDestinations(chrome.runtime, controller.signal);
          if (controller.signal.aborted) return;
          setFolders(value);
          setFolder(value[0]?.id ?? '');
          setFoldersChecked(true);
        },
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setFolderError(cause instanceof Error ? cause.message : 'Could not check save folders.');
    } finally {
      if (folderRequest.current === controller) {
        folderRequest.current = null;
        if (!controller.signal.aborted) setFolderBusy(false);
      }
    }
  }

  return (
    <section className="storage-settings panel" aria-label="Media downloader">
      <div>
        <h3>Media downloader</h3>
        <p>Inspect a public media link, review formats and select an approved save folder.</p>
        <p className="small muted">
          Preview: inspection and folder setup work now. Saving media, merging tracks and MP3
          conversion are not available yet.
        </p>
      </div>
      <div className="form-stack media-destinations">
        <label>
          Companion save folder
          <select
            aria-label="Companion save folder"
            value={folder}
            disabled={!folders.length || folderBusy}
            onChange={(event) => setFolder(event.target.value)}
          >
            {!folders.length && (
              <option value="">
                {foldersChecked
                  ? 'No approved folders available'
                  : 'Refresh to load approved folders'}
              </option>
            )}
            {folders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar">
          <a
            className="button secondary"
            href="companion/flux-media-folder-setup-macos.zip"
            download="flux-media-folder-setup-macos.zip"
          >
            Download folder setup
          </a>
          <button
            type="button"
            className="button secondary"
            disabled={folderBusy || busy || Boolean(review)}
            onClick={() => void refreshFolders()}
          >
            {folderBusy ? 'Checking save folders…' : 'Refresh save folders'}
          </button>
        </div>
        <p className="small muted">
          Unzip and open Choose save folder.command to choose a folder on your Mac, then refresh
          this list. Close any media review before refreshing. Folder approval stays local to the
          companion; the browser download folder is configured separately.
        </p>
        {foldersChecked && !folders.length && (
          <p role="status">
            No approved save folders found. Run folder setup, then refresh. A moved or replaced
            folder needs approval again.
          </p>
        )}
        {folderError && (
          <p role="alert" className="error-message">
            {folderError}
          </p>
        )}
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
            disabled={busy || folderBusy}
            placeholder="https://example.com/watch"
          />
        </label>
        <div className="toolbar">
          <button className="button secondary" disabled={busy || folderBusy}>
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
            <p className="small muted">
              {(() => {
                const format = review.formats.find((item) => item.selectionId === selection);
                if (!format) return '';
                const video =
                  format.hasVideo === null
                    ? 'Video track unverified'
                    : format.hasVideo
                      ? 'Has video'
                      : 'No video';
                const audio =
                  format.hasAudio === null
                    ? 'audio track unverified'
                    : format.hasAudio
                      ? 'has audio'
                      : 'no audio';
                return `${video}; ${audio}.`;
              })()}
            </p>
            <button
              type="button"
              className="button primary"
              disabled
              aria-describedby="media-download-status"
            >
              Download media
            </button>
            <p id="media-download-status" className="small muted">
              Downloads are not enabled in this preview. Your format and folder selections do not
              start a transfer.
            </p>
          </div>
        )}
      </form>
    </section>
  );
}
