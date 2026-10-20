import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ExternalLink, Link2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import type { ManagerAPI } from '../../application/contracts';
import { validateUrl } from '../../shared/security';
import { sanitizeFilename } from '../../shared/files';
import type { HlsReview } from '../../engine/media/types';
import { HostPermissionError } from '../../engine/network/policy';
export function AddDownload({
  manager,
  onClose,
  initialUrl = '',
}: {
  manager: ManagerAPI;
  onClose: () => void;
  initialUrl?: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inspection = useRef<AbortController | null>(null);
  const [kind, setKind] = useState<'file' | 'hls'>('file');
  const [review, setReview] = useState<HlsReview | null>(null);
  const [variant, setVariant] = useState('');
  const [grant, setGrant] = useState<string | null>(null);
  useEffect(() => () => inspection.current?.abort(), []);
  async function preview(target?: string, origin?: string) {
    setBusy(true);
    setError('');
    setGrant(null);
    inspection.current?.abort();
    const controller = new AbortController();
    inspection.current = controller;
    try {
      if (origin && !(await chrome.permissions.request({ origins: [origin + '/*'] })))
        throw new Error('Website access was declined.');
      const input = formRef.current!.querySelector<HTMLInputElement>('[name="url"]')!;
      if (target) input.value = target;
      const result = await manager.inspectHls(input.value.trim(), controller.signal);
      if (controller.signal.aborted) return;
      input.value = result.url;
      setReview(result);
      if (result.kind === 'master')
        setVariant(result.variants.find((item) => !item.externalAudio)?.url ?? '');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      if (cause instanceof HostPermissionError) setGrant(cause.origin);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const url = String(form.get('url')).trim();
      if (kind === 'hls' && (review?.kind !== 'media' || review.url !== validateUrl(url).href))
        throw new Error('Review the selected HLS rendition before adding it.');
      await manager.add({
        url,
        media: kind === 'hls' ? 'hls' : undefined,
        filename: String(form.get('filename')).trim() || undefined,
        expectedHash: String(form.get('hash')).trim() || undefined,
        priority: Number(form.get('priority')),
        speedLimit: Number(form.get('speed')) * 1024,
        scheduledAt: form.get('schedule') ? new Date(String(form.get('schedule'))).getTime() : null,
        queueId: String(form.get('queueId')),
        startPaused: form.get('startPaused') === 'on',
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function useBrowser() {
    if (kind === 'hls') {
      setError(
        'Chrome would save only the playlist. Choose a supported HLS rendition for Flux assembly.',
      );
      return;
    }
    setError('');
    setBusy(true);
    try {
      const form = new FormData(formRef.current!);
      const url = validateUrl(String(form.get('url')).trim());
      if (!globalThis.chrome?.runtime?.id)
        throw new Error(
          'The browser downloader is available after installing the Flux Chrome extension.',
        );
      const filename = String(form.get('filename')).trim();
      const id = await chrome.downloads.download({
        url: url.href,
        saveAs: true,
        ...(filename ? { filename: sanitizeFilename(filename) } : {}),
      });
      const result = await chrome.runtime.sendMessage({ type: 'register-native', id });
      if (result?.error)
        throw new Error(
          'Chrome started the transfer, but Flux could not link it. Review Chrome downloads. ' +
            result.error,
        );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a download" onClose={onClose}>
      <form ref={formRef} onSubmit={(event) => void submit(event)} className="form-stack">
        <p className="muted">
          Paste a direct file link. Flux checks the server and chooses a safe connection strategy.
        </p>
        <label>
          Download type
          <select
            value={kind}
            onChange={(event) => {
              inspection.current?.abort();
              setBusy(false);
              setKind(event.target.value as 'file' | 'hls');
              setReview(null);
              setGrant(null);
            }}
          >
            <option value="file">Direct file</option>
            <option value="hls">HLS video (MP4 VOD)</option>
          </select>
        </label>
        <label>
          Download URL{' '}
          <div className="input-icon">
            <Link2 size={17} />
            <input
              name="url"
              type="url"
              required
              autoFocus
              defaultValue={initialUrl}
              onChange={() => {
                inspection.current?.abort();
                setBusy(false);
                setReview(null);
                setGrant(null);
              }}
              aria-describedby="download-url-help"
              placeholder="https://example.com/file.zip"
            />
          </div>
        </label>
        <p id="download-url-help" className="small muted">
          Review the link before downloading. If a server does not work with Flux, use Chrome's
          browser downloader below.
        </p>
        <label>
          File name <span className="optional">optional</span>
          <input name="filename" placeholder="Use the server's filename" />
        </label>
        {kind === 'hls' && (
          <div className="form-stack">
            <p className="small muted">
              Select a completed, unencrypted MP4 HLS rendition. This version supports H.264/AAC
              tracks already together in one rendition. Separate audio, MPEG-TS and live recording
              require further media support.
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void preview()}
            >
              Review HLS playlist
            </button>
            {grant && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void preview(undefined, grant)}
              >
                Allow stream website
              </button>
            )}
            {review?.kind === 'master' && (
              <>
                <label>
                  Video quality
                  <select value={variant} onChange={(event) => setVariant(event.target.value)}>
                    {review.variants.map((item) => (
                      <option key={item.url} value={item.url} disabled={item.externalAudio}>
                        {item.resolution ?? 'Rendition'} · {Math.round(item.bandwidth / 1000)} kb/s
                        {item.externalAudio ? ' · separate audio needs mux support' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !variant}
                  onClick={() => void preview(variant)}
                >
                  Review selected quality
                </button>
              </>
            )}
            {review?.kind === 'media' && (
              <p role="status">
                {review.parts} media parts · {review.duration.toFixed(1)} seconds. Output: MP4.
                Container and source identity are checked before saving.
              </p>
            )}
          </div>
        )}
        <label>
          Download queue
          <select name="queueId" defaultValue="default">
            <option value="default">Default queue</option>
            {manager.getSnapshot().settings.queues.map((queue) => (
              <option key={queue.id} value={queue.id}>
                {queue.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input name="startPaused" type="checkbox" /> Add paused
        </label>
        <div className="form-grid">
          <label>
            Priority
            <select name="priority" defaultValue="0">
              <option value="2">High</option>
              <option value="0">Normal</option>
              <option value="-2">Low</option>
            </select>
          </label>
          <label>
            Speed limit <span className="optional">KB/s · 0 = unlimited</span>
            <input name="speed" type="number" min="0" defaultValue="0" />
          </label>
        </div>
        <label>
          Schedule <span className="optional">local time · optional</span>
          <input name="schedule" type="datetime-local" />
        </label>
        <label>
          Expected SHA-256 <span className="optional">optional</span>
          <input
            name="hash"
            minLength={64}
            maxLength={64}
            pattern="[a-fA-F0-9]{64}"
            placeholder="64-character checksum"
            spellCheck={false}
          />
        </label>
        <div className="notice">
          Keep this manager tab open while downloading. Scheduled transfers also require an open
          manager.
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button
            type="button"
            className="text-button browser-fallback"
            onClick={() => void useBrowser()}
            disabled={busy || kind === 'hls'}
          >
            <ExternalLink size={14} /> Use browser
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            <ArrowDownToLine size={16} />
            {busy ? 'Working…' : 'Add download'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
