import { useState } from 'react';
import {
  ArrowDownToLine,
  CircleAlert,
  FileDown,
  ListOrdered,
  LoaderCircle,
  Settings,
  X,
  Zap,
} from 'lucide-react';
import type { DownloadQueue } from '../../domain/model';
import { queueStatus } from '../components/queue-status';

export interface QueueChoice {
  items: { id: string; filename: string; url?: string }[];
  at: number;
}

/** Asks which queue newly captured downloads join before any of them starts. */
export function QueueChooser({
  choice,
  queues,
  onDone,
}: {
  choice: QueueChoice;
  queues: DownloadQueue[];
  onDone: (added: number) => void;
}) {
  const [queueId, setQueueId] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = choice.items.length;
  async function send(mode: 'now' | 'paused' | 'cancel') {
    setBusy(true);
    setError('');
    try {
      const reply = await chrome.runtime.sendMessage({
        type: 'queue-choice',
        ids: choice.items.map((item) => item.id),
        queueId,
        mode,
      });
      if (reply?.error) throw new Error(reply.error);
      onDone(mode === 'cancel' ? 0 : count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="embedded-dialog queue-chooser" aria-label="Choose a queue">
      <header className="modal-header">
        <h2>
          <Zap size={20} aria-hidden="true" />
          Add Download
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={() => void send('cancel')}
        >
          <X size={19} />
        </button>
      </header>
      <div className="add-form form-stack">
        <p className="chooser-title">
          <ListOrdered size={16} />
          {count === 1 ? 'Where should this download go?' : `Where should ${count} downloads go?`}
        </p>
        <ul className="chooser-files">
          {choice.items.slice(0, 5).map((item) => (
            <li key={item.id} title={item.url ?? item.filename}>
              <span className="chooser-icon">
                <FileDown size={17} />
              </span>
              <span className="chooser-name">{item.filename}</span>
            </li>
          ))}
          {count > 5 && <li className="muted">+{count - 5} more</li>}
        </ul>
        <div className="chooser-options" role="radiogroup" aria-label="Queue">
          <label className="choice">
            <input
              type="radio"
              name="queue"
              checked={queueId === 'default'}
              onChange={() => setQueueId('default')}
            />
            <span>
              Download now
              <small>Default queue · starts right away</small>
            </span>
          </label>
          {queues.map((queue) => (
            <label className="choice" key={queue.id}>
              <input
                type="radio"
                name="queue"
                checked={queueId === queue.id}
                onChange={() => setQueueId(queue.id)}
              />
              <span>
                {queue.name}
                <small>{queueStatus(queue).label}</small>
              </span>
            </label>
          ))}
        </div>
        {error && (
          <div className="error-message" role="alert">
            <CircleAlert size={14} /> {error}
          </div>
        )}
        <footer className="modal-footer add-footer">
          <span className="remember">
            <Settings size={16} />
            {count} {count === 1 ? 'link' : 'links'} selected
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void send('cancel')}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void send('paused')}
          >
            Add paused
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void send('now')}
          >
            {busy ? <LoaderCircle className="spin" size={15} /> : <ArrowDownToLine size={16} />}
            {queueId === 'default' ? 'Download' : 'Add to queue'}
          </button>
        </footer>
      </div>
    </section>
  );
}
