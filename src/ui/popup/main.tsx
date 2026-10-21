import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  Archive,
  AudioLines,
  ChevronRight,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Settings,
  Video,
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
import { bytes, eta, hostname, isActive, percent, stateLabel } from '../components/format';
import { captureOrigins } from '../../shared/capture';
import { browserNeedsReview } from '../../domain/browser-download';
import { QueueChooser, type QueueChoice } from './QueueChooser';
import { AddDownload } from '../manager/AddDownload';
import type { ManagerAPI } from '../../application/contracts';
import '../theme.css';
const categoryIcons = {
  Documents: FileText,
  Archives: Archive,
  Videos: Video,
  Audio: AudioLines,
  Images: ImageIcon,
  Software: LayoutGrid,
  Other: FileIcon,
};
const SPARK_POINTS = 24;
/** Area chart of recent transfer speed; a gentle wave while idle. */
function Spark({ samples }: { samples: number[] }) {
  const { line, area } = useMemo(() => {
    const max = Math.max(...samples, 1);
    const flat = max <= 1;
    const path = samples
      .map((value, index) => {
        const x = (index / (SPARK_POINTS - 1)) * 200;
        const y = flat ? 48 - Math.sin(index / 3) * 6 : 56 - (value / max) * 46;
        return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    return { line: path, area: `${path} L200 70 L0 70 Z` };
  }, [samples]);
  return (
    <svg className="popup-spark" viewBox="0 0 200 70" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}
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
  const [notice, setNotice] = useState(0);
  const [choice, setChoice] = useState<QueueChoice | null>(null);
  useEffect(() => {
    if (!globalThis.chrome?.storage?.session) return;
    // Captured downloads wait here until the user picks their queue.
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session' && changes.queueChoice)
        setChoice((changes.queueChoice.newValue as QueueChoice | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.session
      .get('queueChoice')
      .then((stored) => setChoice((stored.queueChoice as QueueChoice | undefined) ?? null));
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  useEffect(() => {
    void read();
    if (!globalThis.chrome?.storage?.session) return;
    // Set by the background when a download was just added from a page.
    const show = (value: unknown) => {
      const item = value as { count?: number; at?: number } | undefined;
      if (item?.count && item.at && Date.now() - item.at < 15000) setNotice(item.count);
    };
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session' && changes.popupNotice) {
        show(changes.popupNotice.newValue);
        void read();
      }
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.session.get('popupNotice').then((stored) => show(stored.popupNotice));
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [read]);
  const active = snapshot?.jobs.filter(isActive) ?? [];
  const waiting =
    snapshot?.jobs.filter(
      (job) => job.state === 'QUEUED' || (job.state === 'FAILED' && job.queueRetryAt != null),
    ).length ?? 0;
  useEffect(() => {
    if (!active.length && !waiting && !notice) return;
    const timer = setInterval(() => void read(), 1000);
    return () => clearInterval(timer);
  }, [active.length, waiting, notice, read]);
  async function grant(job: DownloadJob) {
    setError('');
    try {
      // The popup may close while Chrome shows the prompt; the background then resumes the job.
      if (!(await chrome.permissions.request({ origins: [`${job.permissionOrigin}/*`] })))
        throw new Error('Website access was declined.');
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function open(add = false, hash = '') {
    try {
      if (!globalThis.chrome?.runtime?.id) {
        location.href = `../manager.html${hash || (add ? '#add' : '')}`;
        return;
      }
      const result = await chrome.runtime.sendMessage({
        type: 'open-manager',
        add,
        ...(hash ? { hash } : {}),
      });
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
  const pending =
    snapshot?.jobs.filter(
      (job) =>
        isActive(job) ||
        ['PAUSED', 'QUEUED', 'WAITING_FOR_NETWORK'].includes(job.state) ||
        (job.state === 'FAILED' && job.queueRetryAt != null),
    ) ?? [];
  const jobs = pending.slice(0, 5);
  const capture =
    snapshot?.settings.confirmCapture && choice?.items.length === 1 && choice.items[0]?.url
      ? choice.items[0]
      : null;
  const batch = !!snapshot && !capture && !!choice?.items.length;
  // The Add Download window needs only a few manager calls; the engine stays in the manager tab.
  const captureApi = useMemo(
    () =>
      snapshot && capture
        ? ({
            subscribe: () => () => undefined,
            getSnapshot: () => snapshot,
            add: async (input: unknown) => {
              const reply = await chrome.runtime.sendMessage({
                type: 'capture-confirm',
                id: capture.id,
                input,
              });
              if (reply?.error) throw new Error(reply.error);
            },
            chooseDownloadFolder: async () => {
              await chrome.runtime.sendMessage({ type: 'open-manager', add: false });
            },
          } as unknown as ManagerAPI)
        : null,
    [snapshot, capture?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    document.documentElement.classList.toggle('capture-mode', !!capture || batch);
  }, [capture, batch]);
  async function discardCapture() {
    if (!capture) return;
    await chrome.runtime
      .sendMessage({ type: 'queue-choice', ids: [capture.id], queueId: 'default', mode: 'cancel' })
      .catch(() => undefined);
    window.close();
  }
  const speed = active.reduce((n, j) => n + j.speed, 0);
  const history = useRef<number[]>(Array(SPARK_POINTS).fill(0));
  const [samples, setSamples] = useState<number[]>(history.current);
  useEffect(() => {
    history.current = [...history.current.slice(1), speed];
    setSamples(history.current);
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  if (snapshot && batch && choice)
    return (
      <QueueChooser
        choice={choice}
        queues={snapshot.settings.queues}
        onDone={(added) => {
          if (added) setNotice(added);
          void read();
        }}
      />
    );
  if (capture && captureApi)
    return (
      <AddDownload
        key={capture.id}
        manager={captureApi}
        initialUrl={capture.url}
        initialFilename={capture.filename}
        embedded={{ onCancel: () => void discardCapture() }}
        onClose={() => window.close()}
      />
    );
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
        <button
          className="icon-button"
          aria-label="Open settings"
          title="Settings"
          onClick={() => void open(false, '#settings')}
        >
          <Settings size={19} />
        </button>
      </header>
      <div className="popup-speed">
        <Spark samples={samples} />
        <span className="eyebrow">LIVE TRANSFER SPEED</span>
        <div>
          <span>{bytes(speed)}</span>
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
          {snapshot.settings.interception && <ChevronRight size={16} className="state-chevron" />}
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
          <span className="count-badge">{pending.length}</span>
        </div>
        {!!notice && (
          <div className="popup-notice" role="status">
            <ArrowDown size={14} />
            {notice === 1 ? 'Download added to Flux' : `${notice} downloads added to the queue`}
          </div>
        )}
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
            <p>Add a link or start downloading a file in your browser.</p>
          </div>
        ) : (
          jobs.map((job) => (
            <div className="popup-job" key={job.id}>
              <div className="popup-job-heading">
                <span className={`file-icon ${job.category.toLowerCase()}`}>
                  {(() => {
                    const Icon = categoryIcons[job.category] ?? FileIcon;
                    return <Icon size={20} strokeWidth={1.7} />;
                  })()}
                </span>
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
                  {bytes(job.downloaded)}
                  {job.total ? ' / ' + bytes(job.total) : ''} · {percent(job).toFixed(0)}%
                  {isActive(job) ? (
                    <>
                      {' '}
                      · <b className="accent-text">{bytes(job.speed)}/s</b> · {eta(job)} left
                    </>
                  ) : (
                    <> · {stateLabel(job.state)}</>
                  )}
                </span>
              </div>
              {job.permissionOrigin && (
                <button className="text-button" onClick={() => void grant(job)}>
                  Allow access to {hostname(job.permissionOrigin)}
                </button>
              )}
            </div>
          ))
        )}
        {pending.length > jobs.length && (
          <p className="popup-more">+{pending.length - jobs.length} more in the queue</p>
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
