import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowUpRight,
  ArrowDownToLine,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { Snapshot, DownloadJob } from '../../domain/model';
import { bytes, isActive, percent, stateLabel } from '../components/format';
import { captureOrigins } from '../../shared/capture';
import { browserNeedsReview } from '../../domain/browser-download';
import '../styles.css';
import './popup.css';
function Popup() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const read = useCallback(async () => {
    try {
      if (!globalThis.chrome?.runtime?.id)
        throw new Error('Open Flux from its Chrome extension toolbar icon.');
      const result = (await chrome.runtime.sendMessage({ type: 'snapshot' })) as Snapshot;
      if (!result || !Array.isArray(result.jobs))
        throw new Error('Open the manager to restore your downloads.');
      setSnapshot(result);
      document.documentElement.dataset.theme =
        result.settings.theme === 'system'
          ? matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : result.settings.theme;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => {
    void read();
  }, [read]);
  const active = snapshot?.jobs.filter(isActive) ?? [];
  const pendingRetries =
    snapshot?.jobs.filter((job) => job.state === 'FAILED' && job.queueRetryAt != null).length ?? 0;
  useEffect(() => {
    if (!active.length && !pendingRetries) return;
    const timer = setInterval(() => void read(), 1000);
    return () => clearInterval(timer);
  }, [active.length, pendingRetries, read]);
  async function open(add = false) {
    try {
      if (!globalThis.chrome?.runtime?.id) {
        location.href = `../manager.html${add ? '#add' : ''}`;
        return;
      }
      const result = await chrome.runtime.sendMessage({ type: 'open-manager', add });
      if (result?.error) throw new Error(result.error);
      window.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function enableCapture() {
    setError('');
    setBusy('capture');
    try {
      if (!(await chrome.permissions.request({ origins: captureOrigins })))
        throw new Error('Website access was declined.');
      const reply = await chrome.runtime.sendMessage({ type: 'enable-capture' });
      if (reply?.error) throw new Error(reply.error);
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }
  async function command(job: DownloadJob) {
    setBusy(job.id);
    setError('');
    try {
      const review =
        job.engine === 'browser' &&
        !isActive(job) &&
        (!job.browser?.canResume || browserNeedsReview(job.browser.danger));
      const result = await chrome.runtime.sendMessage({
        type: review ? 'native-command' : 'command',
        id: job.id,
        action: review ? 'review-browser' : isActive(job) ? 'pause' : 'resume',
      });
      if (result?.error) throw new Error(result.error);
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }
  const jobs =
    snapshot?.jobs
      .filter(
        (job) =>
          isActive(job) ||
          ['PAUSED', 'QUEUED', 'WAITING_FOR_NETWORK'].includes(job.state) ||
          (job.state === 'FAILED' && job.queueRetryAt != null),
      )
      .slice(0, 4) ?? [];
  return (
    <div className="popup-shell">
      <header className="popup-header">
        <a
          className="brand"
          href="../manager.html"
          onClick={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          <span className="brand-mark">
            <Zap size={22} fill="currentColor" />
          </span>
          <span>
            flux<span className="brand-dot">.</span>
          </span>
        </a>
        <button
          className="icon-button"
          aria-label="Open full manager"
          title="Open full manager"
          onClick={() => void open()}
        >
          <ArrowUpRight size={19} />
        </button>
      </header>
      <div className="popup-speed">
        <span className="eyebrow">LIVE TRANSFER SPEED</span>
        <div>
          <span>{bytes(active.reduce((n, j) => n + j.speed, 0))}</span>
          <small>/s</small>
        </div>
        <p>
          <span className={`live-dot ${active.length ? 'live' : ''}`} />
          {active.length} active download{active.length === 1 ? '' : 's'}
        </p>
      </div>
      {snapshot && (
        <div className="popup-capture-state">
          <ShieldCheck size={15} />
          <span>
            {snapshot.settings.interception
              ? 'Automatic capture is on'
              : 'Automatic capture is off'}
          </span>
          {!snapshot.settings.interception && (
            <button
              className="text-button"
              onClick={() => void enableCapture()}
              disabled={busy === 'capture'}
            >
              Enable
            </button>
          )}
        </div>
      )}
      <div className="popup-list">
        <div className="section-heading">
          <h2>Current downloads</h2>
          <span className="count-badge">{jobs.length}</span>
        </div>
        {error && (
          <div className="error-message" role="alert">
            <CircleAlert size={14} /> {error}
          </div>
        )}
        {!snapshot && !error ? (
          <div className="popup-empty">
            <LoaderCircle className="spin" size={24} />
            <p>Loading your workspace…</p>
          </div>
        ) : !jobs.length ? (
          <div className="popup-empty">
            <ArrowDownToLine size={27} />
            <h3>Ready for your next file</h3>
            <p>Add a direct link to get started.</p>
          </div>
        ) : (
          jobs.map((job) => (
            <div className="popup-job" key={job.id}>
              <div className="popup-job-heading">
                <strong title={job.filename}>{job.filename}</strong>
                <button
                  className="icon-button"
                  aria-label={`${isActive(job) ? 'Pause' : job.engine === 'browser' && (!job.browser?.canResume || browserNeedsReview(job.browser.danger)) ? 'Review in Chrome' : 'Resume'} ${job.filename}`}
                  onClick={() => void command(job)}
                  disabled={busy === job.id || job.state === 'PAUSING' || job.state === 'EXPORTING'}
                >
                  {busy === job.id ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : isActive(job) ? (
                    <Pause size={15} />
                  ) : job.engine === 'browser' &&
                    (!job.browser?.canResume || browserNeedsReview(job.browser.danger)) ? (
                    <ExternalLink size={15} />
                  ) : (
                    <Play size={15} />
                  )}
                </button>
              </div>
              <div className="progress">
                <span style={{ width: `${percent(job)}%` }} />
              </div>
              <div className="popup-job-meta">
                <span>
                  {percent(job).toFixed(1)}%{' '}
                  <span className="muted">· {stateLabel(job.state)}</span>
                </span>
                <span className="accent-text">{bytes(job.speed)}/s</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="popup-buttons">
        <button className="button primary" onClick={() => void open(true)}>
          <Plus size={16} /> Add download
        </button>
        <button className="button secondary" onClick={() => void open()}>
          <ExternalLink size={15} /> Open manager
        </button>
      </div>
      <footer className="popup-footer">
        <ShieldCheck size={12} />
        <span>
          {active.length && active.every((job) => job.engine === 'browser')
            ? 'Original browser transfers continue while Chrome is open.'
            : 'Keep the manager open during Flux transfers.'}
        </span>
      </footer>
      <p className="popup-credit">
        created by <strong>Vexor</strong>
      </p>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Popup />);
