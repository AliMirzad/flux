import { useMemo, useState } from 'react';
import type { ManagerAPI } from '../../application/contracts';
import { parseDownloadList } from '../../application/lists';
import { Modal } from '../components/Modal';

export function BatchDownloads({
  manager,
  initialText = '',
  onClose,
}: {
  manager: ManagerAPI;
  initialText?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [queueId, setQueueId] = useState('default');
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [excluded, setExcluded] = useState(new Set<string>());
  const parsed = useMemo(() => {
    try {
      return { items: parseDownloadList(text), error: '' };
    } catch (cause) {
      return { items: [], error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [text]);
  const visible = parsed.items.filter(
    (item) =>
      !filter || `${item.filename ?? ''} ${item.url}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const selected = visible.filter((item) => !excluded.has(item.url));
  async function add() {
    setError('');
    setBusy(true);
    try {
      const outcome = await manager.addBatch(
        selected.map((item) => ({ ...item, queueId, startPaused: paused })),
      );
      setResult(`${outcome.added} added; ${outcome.skipped} already queued.`);
      setText('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add multiple downloads" onClose={onClose} wide>
      <div className="form-stack">
        <p className="muted">
          Paste one URL per line, import a text/JSON list, or drop links here. Number patterns such
          as file[001:010].zip expand before review.
        </p>
        <label>
          Download links
          <textarea
            aria-label="Download links"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult('');
              setExcluded(new Set());
            }}
            rows={6}
            placeholder="https://example.com/file.zip"
          />
        </label>
        <label>
          Import text or JSON file
          <input
            type="file"
            accept=".txt,.json,text/plain,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                setError('Choose a list smaller than 2 MiB.');
                return;
              }
              void file.text().then(
                (value) => {
                  setText(value);
                  setExcluded(new Set());
                },
                () => setError('Could not read the selected list.'),
              );
            }}
          />
        </label>
        <div className="form-grid">
          <label>
            Download queue
            <select value={queueId} onChange={(event) => setQueueId(event.target.value)}>
              <option value="default">Default queue</option>
              {manager.getSnapshot().settings.queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter links
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder=".zip, filename, or hostname"
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={paused}
            onChange={(event) => setPaused(event.target.checked)}
          />{' '}
          Add paused
        </label>
        {parsed.error && (
          <p className="error-message" role="alert">
            {parsed.error}
          </p>
        )}
        {!!visible.length && (
          <div className="batch-preview" aria-label="Download list preview">
            {visible.map((item) => (
              <label className="batch-item" key={item.url}>
                <input
                  type="checkbox"
                  checked={!excluded.has(item.url)}
                  onChange={(event) =>
                    setExcluded((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.delete(item.url);
                      else next.add(item.url);
                      return next;
                    })
                  }
                />
                <span title={item.url}>
                  {item.filename ||
                    new URL(item.url).pathname.split('/').pop() ||
                    new URL(item.url).hostname}
                  <small>{new URL(item.url).hostname}</small>
                </span>
              </label>
            ))}
          </div>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="notice" role="status">
            {result}
          </p>
        )}
        <footer className="modal-footer">
          <span className="muted">{selected.length} selected</span>
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
          <button
            className="button primary"
            disabled={busy || !selected.length || !!parsed.error}
            onClick={() => void add()}
          >
            {busy ? 'Adding…' : 'Add selected downloads'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
