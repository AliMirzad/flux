import { useMemo, useState } from 'react';
import { ClipboardPaste, FileUp, Link2, ListChecks, WandSparkles } from 'lucide-react';
import type { ManagerAPI } from '../../application/contracts';
import { buildNumberPattern, parseDownloadList } from '../../application/lists';
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
  const [sample, setSample] = useState('');
  const [lastNumber, setLastNumber] = useState('');
  const [excluded, setExcluded] = useState(new Set<string>());
  async function paste() {
    try {
      setText((await navigator.clipboard.readText()).trim());
      setExcluded(new Set());
      setResult('');
      setError('');
    } catch {
      setError('Clipboard access is unavailable. Paste your links into the box with Ctrl+V.');
    }
  }
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
      <div className="form-stack batch-dialog">
        <div className="dialog-intro">
          <span className="intro-icon">
            <Link2 size={22} />
          </span>
          <div>
            <h3>One list. All your downloads.</h3>
            <p>Paste a link on each line, review your selection, then add them together.</p>
          </div>
        </div>
        <div className="batch-input-heading">
          <label htmlFor="batch-links">Download links</label>
          <button type="button" className="text-button" onClick={() => void paste()}>
            <ClipboardPaste size={15} /> Paste from clipboard
          </button>
        </div>
        <textarea
          id="batch-links"
          aria-label="Download links"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setResult('');
            setExcluded(new Set());
          }}
          rows={5}
          placeholder={'https://example.com/file.zip\nhttps://example.com/another-file.pdf'}
          spellCheck={false}
        />
        <div className="batch-tools">
          <label className="import-button">
            <FileUp size={16} /> Import text or JSON file
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
                    setResult('');
                  },
                  () => setError('Could not read the selected list.'),
                );
              }}
            />
          </label>
          <span className="small muted">TXT or JSON · up to 2 MiB</span>
        </div>
        <details className="series-builder">
          <summary>
            <WandSparkles size={16} />
            <span>
              Generate a numbered series
              <small>For links such as video-01.mp4 through video-20.mp4</small>
            </span>
          </summary>
          <fieldset className="form-grid">
            <legend className="sr-only">Numbered series</legend>
            <label>
              First link of the series
              <input
                value={sample}
                onChange={(event) => setSample(event.target.value)}
                placeholder="https://example.com/video-01.mp4"
              />
            </label>
            <label>
              Last number
              <input
                type="number"
                min={0}
                value={lastNumber}
                onChange={(event) => setLastNumber(event.target.value)}
                placeholder="20"
              />
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={!sample.trim() || !lastNumber}
              onClick={() => {
                try {
                  setText(buildNumberPattern(sample, Number(lastNumber)));
                  setExcluded(new Set());
                  setResult('');
                  setError('');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              Generate links
            </button>
          </fieldset>
          <p className="small muted">
            You can also paste a pattern directly, such as file[001:010].zip.
          </p>
        </details>
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
          <section className="batch-review">
            <div className="batch-review-heading">
              <h3>
                <ListChecks size={17} /> Review links{' '}
                <span className="count-badge">{visible.length}</span>
              </h3>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setExcluded(
                    selected.length === visible.length
                      ? new Set(visible.map((item) => item.url))
                      : new Set(),
                  )
                }
              >
                {selected.length === visible.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
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
          </section>
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
          <span className="footer-summary">{selected.length} selected</span>
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
