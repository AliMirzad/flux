import { useState } from 'react';
import type { ManagerAPI } from '../../application/contracts';
import type { DownloadQueue } from '../../domain/model';
import { Modal } from '../components/Modal';

export function Queues({ manager, onClose }: { manager: ManagerAPI; onClose: () => void }) {
  const localDate = (at?: number | null) =>
    at == null
      ? ''
      : new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [draft, setDraft] = useState<DownloadQueue>({
    id: crypto.randomUUID(),
    name: '',
    maxActive: 1,
    paused: true,
    speedLimit: 0,
    windowStart: '',
    windowEnd: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const queues = manager.getSnapshot().settings.queues;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Download queues" onClose={onClose} wide>
      <div className="form-stack">
        <p className="muted">
          Give each queue its own concurrency, speed limit, and daily time window. All queues share
          the global limits. Keep the manager open for scheduling.
        </p>
        <div className="queue-list">
          {queues.map((queue) => (
            <div className="queue-item" key={queue.id}>
              <div>
                <strong>{queue.name}</strong>
                <small>
                  {queue.paused ? 'Stopped' : 'Running'} · {queue.maxActive} at a time ·{' '}
                  {manager.getSnapshot().jobs.filter((job) => job.queueId === queue.id).length}{' '}
                  files
                </small>
              </div>
              <div className="queue-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => manager.saveQueue({ ...queue, paused: !queue.paused }))
                  }
                >
                  {queue.paused ? 'Start queue' : 'Stop queue'}
                </button>
                <button className="text-button" onClick={() => setDraft(queue)}>
                  Edit
                </button>
                <button
                  className="text-button danger-text"
                  disabled={busy}
                  onClick={() => void run(() => manager.removeQueue(queue.id))}
                >
                  Remove queue
                </button>
              </div>
            </div>
          ))}
        </div>
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await manager.saveQueue(draft);
              setDraft({
                id: crypto.randomUUID(),
                name: '',
                maxActive: 1,
                paused: true,
                speedLimit: 0,
                windowStart: '',
                windowEnd: '',
              });
            });
          }}
        >
          <h3>{queues.some((queue) => queue.id === draft.id) ? 'Edit queue' : 'Create a queue'}</h3>
          <label>
            Queue name
            <input
              required
              maxLength={60}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <div className="form-grid">
            <label>
              Concurrent downloads
              <input
                type="number"
                min={1}
                max={8}
                value={draft.maxActive}
                onChange={(event) => setDraft({ ...draft, maxActive: Number(event.target.value) })}
              />
            </label>
            <label>
              Queue speed limit (KB/s)
              <input
                type="number"
                min={0}
                value={draft.speedLimit / 1024}
                onChange={(event) =>
                  setDraft({ ...draft, speedLimit: Number(event.target.value) * 1024 })
                }
              />
            </label>
            <label>
              Queue window start
              <input
                type="time"
                value={draft.windowStart}
                onChange={(event) => setDraft({ ...draft, windowStart: event.target.value })}
              />
            </label>
            <label>
              Queue window end
              <input
                type="time"
                value={draft.windowEnd}
                onChange={(event) => setDraft({ ...draft, windowEnd: event.target.value })}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.stopOnComplete ?? false}
              disabled={!!draft.repeatMinutes}
              onChange={(event) => setDraft({ ...draft, stopOnComplete: event.target.checked })}
            />{' '}
            Stop queue when all files are verified
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.notifyOnComplete ?? false}
              onChange={(event) => setDraft({ ...draft, notifyOnComplete: event.target.checked })}
            />{' '}
            Queue completion notification
          </label>
          <p className="small muted">
            Queue notifications use the Notifications preference. The queue completes after
            verification; saving may still be pending.
          </p>
          <label>
            Repeat queue every (minutes, 0 = once)
            <input
              type="number"
              min="0"
              max="10080"
              step="1"
              value={draft.repeatMinutes ?? 0}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  repeatMinutes: Number(event.target.value),
                  stopOnComplete: Number(event.target.value) > 0 ? false : draft.stopOnComplete,
                })
              }
            />
          </label>
          <p className="small muted">
            Periodic runs download a new copy of each non-canceled file. Up to 500 unique addresses
            per queue. Existing verified copies are retained, so repeated runs use disk space and
            download allowance.
          </p>
          <fieldset className="queue-days">
            <legend>Scheduled days</legend>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
              <label className="checkbox-label" key={day}>
                <input
                  type="checkbox"
                  checked={(draft.days ?? [0, 1, 2, 3, 4, 5, 6]).includes(index)}
                  onChange={(event) => {
                    const days = draft.days ?? [0, 1, 2, 3, 4, 5, 6];
                    setDraft({
                      ...draft,
                      days: event.target.checked
                        ? [...days, index]
                        : days.filter((day) => day !== index),
                    });
                  }}
                />
                {day}
              </label>
            ))}
          </fieldset>
          <div className="form-grid">
            <label>
              Queue first start
              <input
                type="datetime-local"
                value={localDate(draft.startsAt)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    startsAt: event.target.value ? new Date(event.target.value).getTime() : null,
                  })
                }
              />
            </label>
            <label>
              Queue final stop
              <input
                type="datetime-local"
                value={localDate(draft.stopsAt)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    stopsAt: event.target.value ? new Date(event.target.value).getTime() : null,
                  })
                }
              />
            </label>
          </div>
          <p className="small muted">
            In an overnight window, the selected day is the day the window opens.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.retryAttempts !== undefined}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  retryAttempts: event.target.checked
                    ? manager.getSnapshot().settings.retryAttempts
                    : undefined,
                  retryDelaySeconds: event.target.checked
                    ? manager.getSnapshot().settings.retryDelaySeconds
                    : undefined,
                })
              }
            />{' '}
            Override automatic retry defaults
          </label>
          {draft.retryAttempts !== undefined ? (
            <div className="form-grid">
              <label>
                Queue automatic retry attempts (0 = off)
                <input
                  type="number"
                  min={0}
                  max={20}
                  step={1}
                  value={draft.retryAttempts}
                  onChange={(event) =>
                    setDraft({ ...draft, retryAttempts: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Queue initial retry delay (seconds)
                <input
                  type="number"
                  min={1}
                  max={86400}
                  step={1}
                  value={
                    draft.retryDelaySeconds ?? manager.getSnapshot().settings.retryDelaySeconds
                  }
                  onChange={(event) =>
                    setDraft({ ...draft, retryDelaySeconds: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          ) : (
            <p className="small muted">
              Uses Settings automatic retry defaults. Temporary failures retry only within this
              queue's running calendar window.
            </p>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.paused}
              onChange={(event) => setDraft({ ...draft, paused: event.target.checked })}
            />{' '}
            Keep queue stopped
          </label>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <footer className="modal-footer">
            <button type="button" className="button secondary" onClick={onClose}>
              Close
            </button>
            <button className="button primary" disabled={busy}>
              Save queue
            </button>
          </footer>
        </form>
      </div>
    </Modal>
  );
}
