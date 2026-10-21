import { useId, useState, type FormEvent } from 'react';
import {
  ExternalLink,
  Save,
  Download,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  XCircle,
  Trash2,
  FileDown,
  SlidersHorizontal,
  Activity,
  Clock3,
  Info,
  type LucideIcon,
} from 'lucide-react';
import type { DownloadJob } from '../../domain/model';
import type { ManagerAPI, Action } from '../../application/contracts';
import { Modal } from '../components/Modal';
import { bytes, eta, hostname, percent, stateLabel } from '../components/format';
import { retryPolicy } from '../../domain/retry';
import { StartChoice, type StartMode } from './StartChoice';
type DetailTab = 'overview' | 'settings' | 'connections' | 'timeline';
const detailTabs: { id: DetailTab; label: string; Icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', Icon: Info },
  { id: 'settings', label: 'Settings', Icon: SlidersHorizontal },
  { id: 'connections', label: 'Connections', Icon: Activity },
  { id: 'timeline', label: 'Timeline', Icon: Clock3 },
];
export function Details({
  job,
  manager,
  onClose,
  run,
}: {
  job: DownloadJob;
  manager: ManagerAPI;
  onClose: () => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const tabId = useId();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [source, setSource] = useState(job.url);
  const [startMode, setStartMode] = useState<StartMode>(job.scheduledAt ? 'later' : 'now');
  const browser = job.engine === 'browser';
  const tabs = detailTabs.filter((item) => !browser || item.id !== 'settings');
  const settings = manager.getSnapshot().settings;
  const policy = retryPolicy(
    settings,
    settings.queues.find((queue) => queue.id === job.queueId),
  );
  const retriesExhausted =
    !browser &&
    job.state === 'FAILED' &&
    job.retryFailure &&
    policy.attempts > 0 &&
    (job.queueRetries ?? 0) >= policy.attempts;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await manager.updateJob(job.id, {
        filename: String(data.get('filename')),
        priority: Number(data.get('priority')),
        speedLimit: Number(data.get('speedLimit')) * 1024,
        maxConnections: Number(data.get('maxConnections')),
        mode: data.get('mode') as DownloadJob['mode'],
        scheduledAt:
          startMode === 'later' && data.get('schedule')
            ? new Date(String(data.get('schedule'))).getTime()
            : null,
        queueId: String(data.get('queueId')),
      });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  const action = (a: Action) => run(() => manager.action(job.id, a));
  const localDate = job.scheduledAt
    ? new Date(job.scheduledAt - new Date(job.scheduledAt).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';
  return (
    <Modal title="Download details" onClose={onClose} wide>
      <div className="detail-body detail-redesign">
        <div className="detail-title">
          <span className="detail-file-icon">
            <FileDown size={25} />
          </span>
          <div>
            <h3>{job.filename}</h3>
            <p>
              {hostname(job.url)}{' '}
              <span className={`status ${job.state.toLowerCase()}`}>{stateLabel(job.state)}</span>
            </p>
          </div>
          <span className="detail-percent">
            {percent(job).toFixed(1)}
            <small>%</small>
          </span>
        </div>
        <div className="progress large">
          <span style={{ width: `${percent(job)}%` }} />
        </div>
        <div className="detail-stats">
          <div>
            <small>Transferred</small>
            <strong>
              {bytes(job.downloaded)} <span>/ {bytes(job.total)}</span>
            </strong>
          </div>
          <div>
            <small>Current speed</small>
            <strong>{bytes(job.speed)}/s</strong>
          </div>
          <div>
            <small>Time remaining</small>
            <strong>{eta(job)}</strong>
          </div>
        </div>
        {job.error && (
          <div className="error-message" role="alert">
            {job.error}
          </div>
        )}
        {job.note && <div className="notice">{job.note}</div>}
        {!browser && (job.queueRetries ?? 0) > 0 && (
          <p className="small muted">Automatic retry attempts used: {job.queueRetries}.</p>
        )}
        {retriesExhausted && (
          <div className="notice">
            The automatic retry limit was reached. Retry manually to start a fresh attempt budget.
          </div>
        )}
        {!browser && job.queueRetryAt != null && job.state === 'FAILED' && (
          <div className="notice">
            Automatic retry {(job.queueRetries ?? 0) + 1} after{' '}
            {new Date(job.queueRetryAt).toLocaleString()}. Queue windows and limits still apply.
            <button className="text-button" onClick={() => action('pause')}>
              Stop automatic retries
            </button>
          </div>
        )}
        {browser && (
          <details className="detail-browser-info">
            <summary>Managed by Chrome</summary>
            <p>
              This is the website's original browser transfer. Chrome retains its authentication,
              request body and destination. Flux shows its status and forwards pause, resume and
              cancel. Segmentation, allowance, export verification and connection limits apply to
              Flux engine downloads.
            </p>
          </details>
        )}
        <div className="detail-tabs" role="tablist" aria-label="Download information">
          {tabs.map(({ id, label, Icon }, index) => (
            <button
              key={id}
              role="tab"
              id={`${tabId}-tab-${id}`}
              aria-controls={`${tabId}-panel-${id}`}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                const nextIndex =
                  event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : -1;
                const next = tabs[nextIndex];
                if (!next) return;
                event.preventDefault();
                setTab(next.id);
                document.getElementById(`${tabId}-tab-${next.id}`)?.focus();
              }}
              className={tab === id ? 'selected' : ''}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <div
          className="form-stack detail-overview"
          role="tabpanel"
          id={`${tabId}-panel-overview`}
          aria-labelledby={`${tabId}-tab-overview`}
          hidden={tab !== 'overview'}
        >
          <div className="source-editor">
            <label>
              Source URL
              <input
                aria-label="Source URL"
                value={source}
                readOnly={browser || job.pageFile}
                onChange={(event) => setSource(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            {!browser && !job.pageFile && source !== job.url && (
              <button
                className="button secondary align-start"
                disabled={
                  busy ||
                  source === job.url ||
                  !['PAUSED', 'FAILED', 'WAITING_FOR_NETWORK', 'QUEUED'].includes(job.state)
                }
                onClick={() => run(() => manager.replaceSource(job.id, source))}
              >
                Refresh download address
              </button>
            )}
            {!browser && !job.pageFile && (
              <p className="small muted source-help">
                For an expired link, pause the transfer and paste a fresh address. Stored ranges are
                reused only after the new resource passes identity validation.
              </p>
            )}
          </div>
          <div className="metadata">
            {job.media?.audioUrl && (
              <>
                <label>
                  Selected audio source
                  <input
                    aria-label="Selected audio source"
                    readOnly
                    value={job.media.audioUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <span>
                  Audio selection <strong>{job.media.audioLabel || 'Separate audio'}</strong>
                </span>
              </>
            )}
            <span>
              Server range support{' '}
              <strong>
                {browser
                  ? 'Managed by Chrome'
                  : job.resource
                    ? job.resource.ranges
                      ? 'Verified'
                      : 'Single stream'
                    : 'Not probed'}
              </strong>
            </span>
            <span>
              Queue{' '}
              <strong>
                {settings.queues.find((queue) => queue.id === job.queueId)?.name ?? 'Default queue'}
              </strong>
            </span>
            <span>
              Created <strong>{new Date(job.createdAt).toLocaleString()}</strong>
            </span>
            <span>
              Export <strong>{job.exported ? 'Saved to file' : 'Pending'}</strong>
            </span>
          </div>
          {job.sha256 && (
            <label>
              SHA-256 checksum
              <input
                className="mono"
                value={job.sha256}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
        </div>
        {!browser && (
          <div
            className="detail-settings"
            role="tabpanel"
            id={`${tabId}-panel-settings`}
            aria-labelledby={`${tabId}-tab-settings`}
            hidden={tab !== 'settings'}
          >
            <div className="detail-section-heading">
              <h3>Download preferences</h3>
              <p>Change how this file is named, queued and transferred.</p>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => void save(event)}
              onChange={() => setSaved(false)}
              key={job.id}
            >
              <div className="form-grid">
                <label>
                  Download queue
                  <select name="queueId" defaultValue={job.queueId ?? 'default'}>
                    <option value="default">Default queue</option>
                    {manager.getSnapshot().settings.queues.map((queue) => (
                      <option key={queue.id} value={queue.id}>
                        {queue.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  File name
                  <input name="filename" required defaultValue={job.filename} />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Priority
                  <select name="priority" defaultValue={job.priority}>
                    <option value="2">High</option>
                    <option value="0">Normal</option>
                    <option value="-2">Low</option>
                    {![2, 0, -2].includes(job.priority) && (
                      <option value={job.priority}>{job.priority}</option>
                    )}
                  </select>
                </label>
                <label>
                  Speed limit <span className="optional">KB/s · 0 = unlimited</span>
                  <input
                    name="speedLimit"
                    type="number"
                    min="0"
                    defaultValue={job.speedLimit / 1024}
                  />
                </label>
                {!job.media && (
                  <label>
                    Connection mode
                    <select name="mode" defaultValue={job.mode}>
                      <option value="auto">Adaptive</option>
                      <option value="manual">Manual</option>
                    </select>
                  </label>
                )}
                {!job.media && (
                  <label>
                    Maximum connections
                    <select name="maxConnections" defaultValue={job.maxConnections}>
                      {[1, 2, 4, 8, 16].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {job.media && (
                  <>
                    <input type="hidden" name="mode" value={job.mode} />
                    <input type="hidden" name="maxConnections" value={job.maxConnections} />
                    <p className="small muted">
                      HLS parts are assembled in order. Speed, queue, priority and schedule still
                      apply.
                    </p>
                  </>
                )}
                <StartChoice
                  mode={startMode}
                  onChange={setStartMode}
                  defaultTime={localDate}
                  allowPaused={false}
                />
              </div>
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <button className="button secondary align-start" disabled={busy}>
                <Save size={15} />
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              {saved && (
                <p className="success" role="status">
                  Changes saved
                </p>
              )}
            </form>
          </div>
        )}
        <div
          className="detail-connections"
          role="tabpanel"
          id={`${tabId}-panel-connections`}
          aria-labelledby={`${tabId}-tab-connections`}
          hidden={tab !== 'connections'}
        >
          <div className="connection-summary">
            <span>
              Average speed <strong>{bytes(job.averageSpeed)}/s</strong>
            </span>
            <span>
              Retries <strong>{job.retries}</strong>
            </span>
          </div>
          {!browser ? (
            <>
              <div className="section-heading compact">
                <h3>{job.connections} active connections</h3>
                <span>{job.segments.length} stored segments</span>
              </div>
              {job.connectionSpeeds.length ? (
                <div className="connection-list">
                  {job.connectionSpeeds.map((speed, index) => (
                    <div key={index}>
                      <span>Connection {index + 1}</span>
                      <div className="connection-bar">
                        <span
                          style={{
                            width: `${Math.max(1, (speed / Math.max(...job.connectionSpeeds, 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <strong>{bytes(speed)}/s</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No active network connections.</p>
              )}
              <h3 className="subheading">Stored file ranges</h3>
              <div className="chunk-map" aria-label={`${job.segments.length} stored ranges`}>
                {job.segments.slice(0, 500).map((segment) => (
                  <span
                    key={segment.start}
                    title={`${bytes(segment.start)}–${bytes(segment.end)} · SHA-256 ${segment.hash}`}
                  />
                ))}
              </div>
              <p className="muted small">
                Each block is a verified, persisted range.
                {job.segments.length > 500 ? ' Showing the first 500 ranges.' : ''}
              </p>
            </>
          ) : (
            <p className="notice">
              Chrome does not expose per-connection details for the original request.
            </p>
          )}
        </div>
        <div
          role="tabpanel"
          id={`${tabId}-panel-timeline`}
          aria-labelledby={`${tabId}-tab-timeline`}
          hidden={tab !== 'timeline'}
        >
          <ol className="timeline">
            {[...job.timeline].reverse().map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <time>{new Date(entry.at).toLocaleString()}</time>
                <span>{entry.event}</span>
              </li>
            ))}
            {!job.timeline.length && <p className="muted">No events recorded yet.</p>}
          </ol>
        </div>
        <footer className="detail-actions">
          {!browser &&
            !job.media &&
            !job.sha256 &&
            !['ASSEMBLING', 'COMPLETED', 'EXPORTING'].includes(job.state) && (
              <button
                className="button secondary"
                onClick={() => run(() => manager.browserDownload(job.id))}
              >
                <ExternalLink size={15} /> Use browser
              </button>
            )}
          {browser && (
            <button className="button secondary" onClick={() => action('review-browser')}>
              <ExternalLink size={15} />
              Review browser download
            </button>
          )}
          {job.state === 'COMPLETED' &&
            (browser
              ? !job.browser?.missing && !job.browser?.erased
              : job.savedDownloadId != null) && (
              <button className="button primary" onClick={() => action('show')}>
                Show in folder
              </button>
            )}
          {!browser &&
            (['ASSEMBLING', 'COMPLETED'].includes(job.state) ||
              (job.state === 'FAILED' && job.sha256)) && (
              <button
                className="button primary"
                onClick={() => run(() => manager.exportFile(job.id))}
              >
                <Download size={15} />
                {job.exported ? 'Save again' : 'Save file'}
              </button>
            )}
          {!browser &&
            (['ASSEMBLING', 'COMPLETED'].includes(job.state) ||
              (job.state === 'FAILED' && job.sha256)) && (
              <button
                className="button secondary"
                onClick={() => run(() => manager.exportFile(job.id, true))}
              >
                Save as…
              </button>
            )}
          {!browser && !job.pageFile && job.state === 'COMPLETED' && (
            <button className="button secondary" onClick={() => action('redownload')}>
              <RotateCcw size={15} /> Download again
            </button>
          )}
          <button
            className="icon-button"
            title="Move up in queue"
            disabled={browser}
            aria-label="Move up in queue"
            onClick={() => action('up')}
          >
            <ArrowUp size={17} />
          </button>
          <button
            className="icon-button"
            title="Move down in queue"
            disabled={browser}
            aria-label="Move down in queue"
            onClick={() => action('down')}
          >
            <ArrowDown size={17} />
          </button>
          {!['COMPLETED', 'CANCELED'].includes(job.state) && (
            <button
              className="icon-button danger-text"
              title="Cancel download"
              aria-label="Cancel download"
              onClick={() => {
                if (window.confirm('Cancel this download? Stored partial data will be removed.'))
                  action('cancel');
              }}
            >
              <XCircle size={17} />
            </button>
          )}
          <button
            className="icon-button danger-text"
            title="Remove download and local data"
            aria-label="Remove download and local data"
            onClick={() => {
              if (
                window.confirm(
                  browser
                    ? 'Remove this transfer from Flux? An active browser transfer will be canceled. Saved files and Chrome history are retained.'
                    : 'Remove this download and its local data?',
                )
              ) {
                action('remove');
                onClose();
              }
            }}
          >
            <Trash2 size={17} />
          </button>
        </footer>
      </div>
    </Modal>
  );
}
