import { useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  Layers,
} from 'lucide-react';
import type { ManagerAPI } from '../../application/contracts';
import type { DownloadJob, DownloadQueue } from '../../domain/model';
import { Modal } from '../components/Modal';
import { QueueFiles } from './QueueFiles';
import { dayNames, hasSchedule, queueStatus, scheduleSummary } from '../components/queue-status';

const allDays = [0, 1, 2, 3, 4, 5, 6];

function blankQueue(): DownloadQueue {
  return {
    id: crypto.randomUUID(),
    name: '',
    maxActive: 1,
    paused: false,
    speedLimit: 0,
    windowStart: '',
    windowEnd: '',
  };
}

function counts(jobs: DownloadJob[], queueId: string) {
  const own = jobs.filter((job) => (job.queueId ?? 'default') === queueId);
  const waiting = own.filter((job) => ['QUEUED', 'PAUSED'].includes(job.state)).length;
  const done = own.filter((job) => job.state === 'COMPLETED').length;
  return `${own.length} files · ${waiting} waiting · ${done} done`;
}

export function Queues({ manager, onClose }: { manager: ManagerAPI; onClose: () => void }) {
  const localDate = (at?: number | null) =>
    at == null
      ? ''
      : new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [draft, setDraft] = useState<DownloadQueue | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const filesToggle = (id: string) => (
    <button
      className="text-button"
      aria-expanded={expanded === id}
      onClick={() => setExpanded(expanded === id ? null : id)}
    >
      {expanded === id ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Files
    </button>
  );
  const snapshot = manager.getSnapshot();
  const queues = snapshot.settings.queues;
  const editing = !!draft && queues.some((queue) => queue.id === draft.id);
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
  function edit(queue: DownloadQueue) {
    setDraft(queue);
    setScheduled(hasSchedule(queue));
    setError('');
  }
  const afterFinish = !draft
    ? 'nothing'
    : draft.repeatMinutes
      ? 'repeat'
      : draft.stopOnComplete
        ? 'stop'
        : 'nothing';
  const days = draft?.days ?? allDays;
  return (
    <Modal title="Download queues" onClose={onClose} wide>
      <div className="form-stack queues-dialog">
        {!draft && (
          <>
            <div className="dialog-intro">
              <span className="intro-icon">
                <Layers size={22} />
              </span>
              <div>
                <h3>Your downloads, at your pace.</h3>
                <p className="muted">
                  A queue downloads its files a few at a time. <strong>Start now</strong> runs it
                  immediately; a schedule starts it on its own. Open <strong>Files</strong> to
                  start, hold or time each file.
                </p>
              </div>
            </div>
            <div className="queue-list">
              <div className="queue-item">
                <div className="queue-info">
                  <div className="queue-title">
                    <strong>Default queue</strong>
                    <span className="queue-status live">Always on</span>
                  </div>
                  <small>Downloads start right away · {counts(snapshot.jobs, 'default')}</small>
                </div>
                <div className="queue-actions">{filesToggle('default')}</div>
                {expanded === 'default' && (
                  <QueueFiles manager={manager} queueId="default" jobs={snapshot.jobs} />
                )}
              </div>
              {!queues.length && (
                <div className="queue-empty">
                  <CalendarClock size={26} />
                  <p>Create a queue to download files later, a few at a time, or on a schedule.</p>
                </div>
              )}
              {queues.map((queue) => {
                const status = queueStatus(queue);
                const running = status.tone === 'live';
                return (
                  <div className="queue-item" key={queue.id}>
                    <div className="queue-info">
                      <div className="queue-title">
                        <strong>{queue.name}</strong>
                        <span className={`queue-status ${status.tone}`}>{status.label}</span>
                      </div>
                      <small>{scheduleSummary(queue)}</small>
                      <small>
                        {queue.maxActive} at a time · {counts(snapshot.jobs, queue.id)}
                      </small>
                    </div>
                    <div className="queue-actions">
                      {running ? (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              manager.saveQueue({ ...queue, paused: true, manualRun: false }),
                            )
                          }
                        >
                          <Square size={14} /> Stop
                        </button>
                      ) : (
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              manager.saveQueue({ ...queue, paused: false, manualRun: true }),
                            )
                          }
                        >
                          <Play size={14} /> Start now
                        </button>
                      )}
                      {queue.paused && hasSchedule(queue) && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          title="Wait for the schedule instead of starting now"
                          onClick={() =>
                            void run(() =>
                              manager.saveQueue({ ...queue, paused: false, manualRun: false }),
                            )
                          }
                        >
                          <CalendarClock size={14} /> Use schedule
                        </button>
                      )}
                      {status.tone === 'wait' && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              manager.saveQueue({ ...queue, paused: true, manualRun: false }),
                            )
                          }
                        >
                          Turn off schedule
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={`Edit ${queue.name}`}
                        title="Edit"
                        onClick={() => edit(queue)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button danger-text"
                        aria-label={`Remove ${queue.name}`}
                        title="Remove queue (files move to the default queue)"
                        disabled={busy}
                        onClick={() => void run(() => manager.removeQueue(queue.id))}
                      >
                        <Trash2 size={15} />
                      </button>
                      {filesToggle(queue.id)}
                    </div>
                    {expanded === queue.id && (
                      <QueueFiles manager={manager} queueId={queue.id} jobs={snapshot.jobs} />
                    )}
                  </div>
                );
              })}
            </div>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <footer className="modal-footer">
              <button type="button" className="button secondary" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setDraft(blankQueue());
                  setScheduled(false);
                  setError('');
                }}
              >
                <Plus size={15} /> New queue
              </button>
            </footer>
          </>
        )}
        {draft && (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              const schedule = scheduled
                ? draft
                : {
                    ...draft,
                    windowStart: '',
                    windowEnd: '',
                    days: undefined,
                    startsAt: null,
                    stopsAt: null,
                  };
              if (scheduled && !hasSchedule(schedule)) {
                setError('Choose a start time, stop time, days, or dates for the schedule.');
                return;
              }
              void run(async () => {
                await manager.saveQueue(
                  editing
                    ? schedule
                    : // A new scheduled queue waits for its schedule; one without starts right away.
                      { ...schedule, paused: false, manualRun: false },
                );
                setDraft(null);
              });
            }}
          >
            <h3>{editing ? `Edit “${draft.name}”` : 'New queue'}</h3>
            <label>
              Queue name
              <input
                required
                autoFocus
                maxLength={60}
                placeholder="e.g. Night downloads"
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
                  onChange={(event) =>
                    setDraft({ ...draft, maxActive: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Queue speed limit (KB/s, 0 = unlimited)
                <input
                  type="number"
                  min={0}
                  value={draft.speedLimit / 1024}
                  onChange={(event) =>
                    setDraft({ ...draft, speedLimit: Number(event.target.value) * 1024 })
                  }
                />
              </label>
            </div>
            <label className="switch-row queue-section">
              <span>
                <strong>Start on a schedule</strong>
                <small>Off: the queue downloads as soon as files are added.</small>
              </span>
              <input
                type="checkbox"
                checked={scheduled}
                onChange={(event) => setScheduled(event.target.checked)}
              />
            </label>
            {scheduled && (
              <div className="queue-schedule">
                <div className="form-grid">
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
                <p className="small muted">
                  Leave the end empty to keep downloading until every file is finished. With an end
                  time, unfinished files pause and continue in the next window.
                </p>
                <div className="queue-days" role="group" aria-label="Scheduled days">
                  {dayNames.map((day, index) => (
                    <label
                      key={day}
                      className={`day-chip ${days.includes(index) ? 'on' : ''}`}
                      title={day}
                    >
                      <input
                        type="checkbox"
                        aria-label={day}
                        checked={days.includes(index)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            days: event.target.checked
                              ? [...days, index].sort()
                              : days.filter((value) => value !== index),
                          })
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
                <details className="queue-advanced">
                  <summary>Date range</summary>
                  <div className="form-grid">
                    <label>
                      Queue first start
                      <input
                        type="datetime-local"
                        value={localDate(draft.startsAt)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            startsAt: event.target.value
                              ? new Date(event.target.value).getTime()
                              : null,
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
                            stopsAt: event.target.value
                              ? new Date(event.target.value).getTime()
                              : null,
                          })
                        }
                      />
                    </label>
                  </div>
                  <p className="small muted">
                    In an overnight window, the selected day is the day the window opens.
                  </p>
                </details>
              </div>
            )}
            <label>
              When all files are finished
              <select
                value={afterFinish}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft({
                    ...draft,
                    stopOnComplete: value === 'stop',
                    repeatMinutes: value === 'repeat' ? draft.repeatMinutes || 60 : 0,
                  });
                }}
              >
                <option value="nothing">Keep the queue ready for new files</option>
                <option value="stop">Stop the queue</option>
                <option value="repeat">Download the same files again periodically</option>
              </select>
            </label>
            {afterFinish === 'repeat' && (
              <label>
                Repeat queue every (minutes, 0 = once)
                <input
                  type="number"
                  min="1"
                  max="10080"
                  step="1"
                  value={draft.repeatMinutes ?? 0}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      repeatMinutes: Number(event.target.value),
                      stopOnComplete: false,
                    })
                  }
                />
              </label>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.notifyOnComplete ?? false}
                onChange={(event) => setDraft({ ...draft, notifyOnComplete: event.target.checked })}
              />{' '}
              Notify me when the queue finishes
            </label>
            <details className="queue-advanced">
              <summary>Automatic retry</summary>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.retryAttempts !== undefined}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      retryAttempts: event.target.checked
                        ? snapshot.settings.retryAttempts
                        : undefined,
                      retryDelaySeconds: event.target.checked
                        ? snapshot.settings.retryDelaySeconds
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
                      value={draft.retryDelaySeconds ?? snapshot.settings.retryDelaySeconds}
                      onChange={(event) =>
                        setDraft({ ...draft, retryDelaySeconds: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
              ) : (
                <p className="small muted">Uses the automatic retry defaults from Settings.</p>
              )}
            </details>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <footer className="modal-footer">
              <button type="button" className="button secondary" onClick={() => setDraft(null)}>
                Back
              </button>
              <button className="button primary" disabled={busy}>
                Save queue
              </button>
            </footer>
          </form>
        )}
      </div>
    </Modal>
  );
}
