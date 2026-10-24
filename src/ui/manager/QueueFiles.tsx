import { useState } from 'react';
import { ArrowDown, ArrowUp, Clock3, Pause, Play, X } from 'lucide-react';
import type { ManagerAPI } from '../../application/contracts';
import type { DownloadJob } from '../../domain/model';
import { bytes, isActive, percent, stateLabel } from '../components/format';

const localInput = (at: number) =>
  new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function describe(job: DownloadJob) {
  if (isActive(job)) return `Downloading · ${percent(job).toFixed(0)}%`;
  if (job.state === 'QUEUED' && job.scheduledAt && job.scheduledAt > Date.now())
    return `Starts ${new Date(job.scheduledAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
  if (job.state === 'QUEUED') return 'Waiting for its turn';
  if (job.state === 'PAUSED') return 'On hold';
  if (job.state === 'ASSEMBLING') return 'Ready to save';
  return stateLabel(job.state);
}

/** Per-file control inside one queue: run now, hold, or start at a set time. */
export function QueueFiles({
  manager,
  queueId,
  jobs,
}: {
  manager: ManagerAPI;
  queueId: string;
  jobs: DownloadJob[];
}) {
  const [timing, setTiming] = useState<{ id: string; value: string } | null>(null);
  const [error, setError] = useState('');
  const run = (fn: () => Promise<unknown>) => {
    setError('');
    void fn().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const own = jobs
    .filter(
      (job) =>
        (job.queueId ?? 'default') === queueId &&
        job.engine !== 'browser' &&
        !['COMPLETED', 'CANCELED'].includes(job.state),
    )
    .sort((a, b) => b.priority - a.priority || a.order - b.order || a.createdAt - b.createdAt);
  async function schedule(job: DownloadJob, at: number | null) {
    if (at !== null && !Number.isFinite(at)) throw new Error('Choose a start time.');
    if (isActive(job)) await manager.action(job.id, 'pause');
    await manager.updateJob(job.id, { scheduledAt: at });
    if (job.state !== 'QUEUED') await manager.action(job.id, 'resume');
    setTiming(null);
  }
  if (!own.length)
    return <p className="small muted queue-files-empty">No unfinished files in this queue.</p>;
  return (
    <div className="queue-files">
      {own.map((job, index) => (
        <div className="queue-file" key={job.id}>
          <div className="queue-file-info">
            <strong title={job.filename}>{job.filename}</strong>
            <small>
              {describe(job)}
              {job.total ? ` · ${bytes(job.total)}` : ''}
            </small>
          </div>
          {timing?.id === job.id ? (
            <span className="bulk-time">
              <input
                type="datetime-local"
                aria-label={`Start time for ${job.filename}`}
                value={timing.value}
                onChange={(event) => setTiming({ id: job.id, value: event.target.value })}
              />
              <button
                className="button primary small"
                onClick={() => run(() => schedule(job, new Date(timing.value).getTime()))}
              >
                Set
              </button>
              <button className="icon-button" aria-label="Cancel" onClick={() => setTiming(null)}>
                <X size={14} />
              </button>
            </span>
          ) : (
            <div className="queue-file-actions">
              {job.state === 'QUEUED' && (
                <>
                  <button
                    className="icon-button"
                    title="Move up"
                    aria-label={`Move ${job.filename} up`}
                    disabled={index === 0}
                    onClick={() => run(() => manager.action(job.id, 'up'))}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-button"
                    title="Move down"
                    aria-label={`Move ${job.filename} down`}
                    disabled={index === own.length - 1}
                    onClick={() => run(() => manager.action(job.id, 'down'))}
                  >
                    <ArrowDown size={14} />
                  </button>
                </>
              )}
              {!isActive(job) && (
                <button
                  className="icon-button accent-text"
                  title="Start now (ignores the schedule)"
                  aria-label={`Start ${job.filename} now`}
                  onClick={() => run(() => manager.action(job.id, 'start'))}
                >
                  <Play size={14} />
                </button>
              )}
              {(isActive(job) || job.state === 'QUEUED') && (
                <button
                  className="icon-button"
                  title="Hold (don’t download yet)"
                  aria-label={`Hold ${job.filename}`}
                  onClick={() => run(() => manager.action(job.id, 'pause'))}
                >
                  <Pause size={14} />
                </button>
              )}
              {job.state === 'PAUSED' && (
                <button
                  className="text-button"
                  title="Put back in line"
                  onClick={() => run(() => manager.action(job.id, 'resume'))}
                >
                  Release
                </button>
              )}
              <button
                className="icon-button"
                title="Start at a set time"
                aria-label={`Start ${job.filename} at a set time`}
                onClick={() =>
                  setTiming({
                    id: job.id,
                    value: localInput(job.scheduledAt ?? Date.now() + 3600000),
                  })
                }
              >
                <Clock3 size={14} />
              </button>
              {job.scheduledAt && job.state === 'QUEUED' && (
                <button
                  className="text-button"
                  title="Remove the start time"
                  onClick={() => run(() => schedule(job, null))}
                >
                  Clear time
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
