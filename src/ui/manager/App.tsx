import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  Archive,
  AudioLines,
  Check,
  CheckCheck,
  CircleCheckBig,
  Database,
  FolderOpen,
  Layers,
  Link2,
  Upload,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  File,
  FileText,
  FolderDown,
  Image,
  LayoutGrid,
  ListFilter,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { manager } from '../../application/client';
import type { DownloadJob, DownloadQueue, Category } from '../../domain/model';
import type { Action } from '../../application/contracts';
import { bytes, eta, hostname, isActive, percent, stateLabel } from '../components/format';
import { Modal } from '../components/Modal';
import { AddDownload } from './AddDownload';
import { Details } from './Details';
import { Settings } from '../settings/Settings';
import { captureOrigins } from '../../shared/capture';
import { BatchDownloads } from './BatchDownloads';
import { Queues } from './Queues';
import { queueStatus } from '../components/queue-status';
import { SaveSetup } from './SaveSetup';
import { exportDownloadList } from './export-list';
import { browserNeedsReview } from '../../domain/browser-download';
interface NativeOffer {
  id: number;
  url: string;
  filename: string;
  at: number;
}
function nativeOffers(value: unknown): NativeOffer[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (offer): offer is NativeOffer =>
        Boolean(offer) &&
        typeof offer.id === 'number' &&
        typeof offer.url === 'string' &&
        typeof offer.filename === 'string' &&
        typeof offer.at === 'number',
    )
    .slice(0, 3);
}
const categoryIcons = {
  Documents: FileText,
  Archives: Archive,
  Videos: Video,
  Audio: AudioLines,
  Images: Image,
  Software: LayoutGrid,
  Other: File,
};
const navigation = [
  { id: 'all', label: 'All downloads', Icon: LayoutGrid },
  { id: 'active', label: 'Downloading', Icon: ArrowDownToLine },
  { id: 'queued', label: 'Queued', Icon: Clock3 },
  { id: 'completed', label: 'Completed', Icon: CheckCheck },
  { id: 'failed', label: 'Failed', Icon: CircleAlert },
];
function matches(job: DownloadJob, view: string) {
  return (
    view === 'all' ||
    (view === 'active' && isActive(job)) ||
    (view === 'queued' && ['QUEUED', 'PAUSED'].includes(job.state)) ||
    (view === 'completed' && ['COMPLETED', 'ASSEMBLING'].includes(job.state)) ||
    (view === 'failed' && job.state === 'FAILED') ||
    job.category === view
  );
}
function JobCard({
  job,
  onDetails,
  action,
  exportFile,
  selected,
  onSelect,
  queue,
}: {
  queue?: DownloadQueue;
  job: DownloadJob;
  onDetails: () => void;
  action: (value: Action) => void;
  exportFile: () => void;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const Icon = categoryIcons[job.category];
  const active = isActive(job);
  const browser = job.engine === 'browser';
  const retryScheduled = !browser && job.state === 'FAILED' && job.queueRetryAt != null;
  const canResume =
    !browser || (!!job.browser?.canResume && !browserNeedsReview(job.browser.danger));
  const ready =
    !browser &&
    (['ASSEMBLING', 'COMPLETED'].includes(job.state) ||
      (job.state === 'FAILED' && Boolean(job.sha256)));
  return (
    <article
      className={`download-card ${job.state === 'FAILED' ? 'has-error' : ''} ${active ? 'is-active' : ''}`}
      data-job-id={job.id}
    >
      <div className={`file-icon ${job.category.toLowerCase()}`}>
        <Icon size={24} strokeWidth={1.6} />
        <input
          className="job-selection"
          type="checkbox"
          aria-label={`Select ${job.filename}`}
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
        />
      </div>
      <div className="download-main">
        <div className="download-name-row">
          <button className="file-name" onClick={onDetails}>
            {job.filename}
          </button>
          <span className={`status ${job.state.toLowerCase()}`}>
            {retryScheduled
              ? 'Retry scheduled'
              : job.state === 'ASSEMBLING'
                ? 'Ready to save'
                : stateLabel(job.state)}
          </span>
        </div>
        <div className="file-meta">
          <span>{hostname(job.url)}</span>
          <span>·</span>
          <span>{job.category}</span>
          {browser && <span className="browser-transport">Original browser transfer</span>}
          {job.media && (
            <span className="browser-transport">
              HLS ·{' '}
              {Math.max(
                0,
                (job.media.completed ?? 0) -
                  (job.media.audioUrl || job.media.transport === 'mpegts' ? 0 : 1),
              )}
              /{job.media.parts ?? '?'} media parts
              {job.media.audioLabel && <> · {job.media.audioLabel}</>}
            </span>
          )}
          {job.priority > 0 && (
            <>
              <span>·</span>
              <span className="priority-high">High priority</span>
            </>
          )}
          {job.scheduledAt && job.state === 'QUEUED' && (
            <>
              <span>·</span>
              <span>{new Date(job.scheduledAt).toLocaleString()}</span>
            </>
          )}
          {queue && (
            <>
              <span>·</span>
              <span
                className={
                  job.state === 'QUEUED' && queueStatus(queue).tone !== 'live' ? 'queue-hint' : ''
                }
              >
                {queue.name}
                {job.state === 'QUEUED' && queueStatus(queue).tone !== 'live'
                  ? ` — ${queueStatus(queue).label.toLowerCase()}`
                  : ''}
              </span>
            </>
          )}
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label={`${job.filename} progress`}
          aria-valuenow={Math.round(percent(job))}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${percent(job)}%` }} />
        </div>
        <div className="download-bottom">
          <span>
            {bytes(job.downloaded)} <span className="muted">/ {bytes(job.total)}</span>
          </span>
          <div>
            {active && (
              <>
                <span className="transfer-speed">
                  <ArrowDown size={12} />
                  {bytes(job.speed)}/s
                </span>
                <span className="muted">{eta(job)} left</span>
                {!browser && (
                  <span className="muted">
                    {job.connections} connection{job.connections === 1 ? '' : 's'}
                  </span>
                )}
              </>
            )}
            {!active && (
              <span className="muted">
                {(retryScheduled
                  ? `Automatic retry ${(job.queueRetries ?? 0) + 1} after ${new Date(job.queueRetryAt!).toLocaleString()}`
                  : null) ||
                  job.error ||
                  job.note ||
                  (job.exported
                    ? 'Saved to your device'
                    : job.state === 'ASSEMBLING'
                      ? 'Verified locally · save to your device'
                      : `${percent(job).toFixed(1)}% transferred`)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="row-actions">
        {retryScheduled && (
          <button
            className="icon-button"
            onClick={() => action('pause')}
            aria-label={`Stop automatic retries for ${job.filename}`}
            title="Stop automatic retries"
          >
            <Pause size={18} />
          </button>
        )}
        {active && job.state !== 'PAUSING' && job.state !== 'EXPORTING' && (
          <button
            className="icon-button"
            onClick={() => action('pause')}
            aria-label={`Pause ${job.filename}`}
            title="Pause"
          >
            <Pause size={18} />
          </button>
        )}
        {['PAUSED', 'WAITING_FOR_NETWORK', 'CANCELED'].includes(job.state) &&
          !job.pageFile &&
          canResume &&
          (!browser || job.state !== 'CANCELED') && (
            <button
              className="icon-button accent-text"
              onClick={() => action(job.state === 'CANCELED' ? 'redownload' : 'resume')}
              aria-label={`Resume ${job.filename}`}
              title="Resume"
            >
              <Play size={18} />
            </button>
          )}
        {job.state === 'QUEUED' && (
          <button
            className="icon-button accent-text"
            onClick={() => action('start')}
            aria-label={`Start ${job.filename}`}
            title="Start now"
          >
            <Play size={18} />
          </button>
        )}
        {job.state === 'FAILED' && !ready && canResume && (
          <button
            className="icon-button"
            onClick={() => action('retry')}
            aria-label={
              job.permissionOrigin
                ? `Grant website access for ${job.filename}`
                : `Retry ${job.filename}`
            }
            title={
              job.permissionOrigin ? `Grant access to ${job.permissionOrigin} and retry` : 'Retry'
            }
          >
            <RefreshCw size={18} />
          </button>
        )}
        {ready && (
          <button
            className="icon-button accent-text"
            onClick={exportFile}
            aria-label={`Save ${job.filename}`}
            title="Save file"
          >
            <Download size={19} />
          </button>
        )}
        {job.state === 'COMPLETED' &&
          (browser
            ? !job.browser?.missing && !job.browser?.erased
            : job.savedDownloadId != null) && (
            <button
              className="icon-button accent-text"
              aria-label={`Show ${job.filename} in folder`}
              title="Show in folder"
              onClick={() => action('show')}
            >
              <FolderDown size={19} />
            </button>
          )}
        {browser && ['PAUSED', 'FAILED', 'CANCELED'].includes(job.state) && !canResume && (
          <button
            className="icon-button"
            aria-label={`Review browser download ${job.filename}`}
            title="Review original download in Chrome"
            onClick={() => action('review-browser')}
          >
            <CircleAlert size={18} />
          </button>
        )}
        <button
          className="icon-button"
          onClick={onDetails}
          aria-label={`Details for ${job.filename}`}
          title="Details and actions"
        >
          <MoreHorizontal size={20} />
        </button>
      </div>
    </article>
  );
}
export function App() {
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [add, setAdd] = useState(new URLSearchParams(location.hash.slice(1)).has('add'));
  const [initialUrl, setInitialUrl] = useState(
    new URLSearchParams(location.hash.slice(1)).get('add') ?? '',
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(
    new URLSearchParams(location.hash.slice(1)).get('error') ?? '',
  );
  const [media, setMedia] = useState<{ url: string; filename: string; media?: 'hls' }[] | null>(
    null,
  );
  const [initialMedia, setInitialMedia] = useState<'hls' | undefined>();
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [offers, setOffers] = useState<NativeOffer[]>([]);
  const [captureAccess, setCaptureAccess] = useState(false);
  const [batch, setBatch] = useState<string | null>(null);
  const [queuesOpen, setQueuesOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState('all');
  const [selection, setSelection] = useState(new Set<string>());
  const [bulkTime, setBulkTime] = useState<string | null>(null);
  useEffect(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    const check = () => {
      void chrome.permissions
        .contains({ origins: captureOrigins })
        .then(setCaptureAccess)
        .catch(() => setCaptureAccess(false));
    };
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [snapshot.settings.interception]);
  const sidebarRef = useRef<HTMLElement>(null);
  const globalSearch = useRef<HTMLInputElement>(null);
  const [bannerHidden, setBannerHidden] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        globalSearch.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const jobs = snapshot.jobs;
  const active = jobs.filter(isActive);
  const speed = active.reduce((n, j) => n + j.speed, 0);
  const completed = jobs.filter((j) => j.state === 'COMPLETED');
  const selectedJob = jobs.find((j) => j.id === selected);
  const run = (fn: () => Promise<unknown>) => {
    setError('');
    void fn().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  useEffect(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    let mounted = true;
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session' && changes.nativeOffers)
        setOffers(nativeOffers(changes.nativeOffers.newValue));
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.session
      .get('nativeOffers')
      .then((stored) => {
        if (mounted) setOffers(nativeOffers(stored.nativeOffers));
      })
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  async function dismissOffer(id: number) {
    const stored = await chrome.storage.session.get('nativeOffers');
    await chrome.storage.session.set({
      nativeOffers: nativeOffers(stored.nativeOffers).filter((offer) => offer.id !== id),
    });
  }
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: light)');
    const update = () => {
      document.documentElement.dataset.theme =
        snapshot.settings.theme === 'system'
          ? query.matches
            ? 'light'
            : 'dark'
          : snapshot.settings.theme;
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [snapshot.settings.theme]);
  useEffect(() => {
    const handler = () => {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.has('add')) {
        setInitialUrl(params.get('add') ?? '');
        setAdd(true);
      }
      if (params.has('error')) setError(params.get('error') ?? 'Could not add this download.');
      if (params.has('settings')) setView('settings');
      if (params.has('add') || params.has('error') || params.has('settings'))
        history.replaceState(null, '', location.pathname + location.search);
    };
    handler();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  const changeView = (value: string) => {
    setView(value);
    setStatusFilter('all');
    setMobileNav(false);
    sidebarRef.current?.scrollTo({ top: 0 });
  };
  const visible = jobs
    .filter(
      (j) =>
        matches(j, view) &&
        (queueFilter === 'all' || (j.queueId ?? 'default') === queueFilter) &&
        (statusFilter === 'all' || j.state === statusFilter) &&
        (j.filename + ' ' + hostname(j.url)).toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.filename.localeCompare(b.filename)
        : sort === 'size'
          ? (b.total ?? 0) - (a.total ?? 0)
          : sort === 'priority'
            ? b.priority - a.priority || a.order - b.order
            : b.createdAt - a.createdAt,
    );
  async function detect() {
    setMediaBusy(true);
    try {
      setMedia(await manager.detectMedia());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMediaBusy(false);
    }
  }
  async function grabLinks() {
    setMediaBusy(true);
    try {
      const links = await manager.discoverLinks();
      setBatch(links.map((item) => item.url).join('\n'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMediaBusy(false);
    }
  }
  const selectAll = () => setSelection(new Set(visible.map((job) => job.id)));
  const selectedJobs = jobs.filter((job) => selection.has(job.id));
  const bulk = (action: Action) =>
    run(async () => {
      if (
        ['cancel', 'remove'].includes(action) &&
        !window.confirm(
          `${action === 'remove' ? 'Remove' : 'Cancel'} ${selectedJobs.length} selected downloads and delete their staged data? Exported files are retained.`,
        )
      )
        return;
      for (const job of selectedJobs) await manager.action(job.id, action);
      setSelection(new Set());
    });
  const nextHour = () => {
    const at = new Date(Date.now() + 3600000);
    at.setMinutes(0, 0, 0);
    return new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  /** Holds the selected files until a chosen time, then the queue starts them. */
  const scheduleSelected = (at: number) =>
    run(async () => {
      if (!Number.isFinite(at)) throw new Error('Choose a start time.');
      for (const job of selectedJobs) {
        if (job.engine === 'browser' || ['COMPLETED', 'ASSEMBLING'].includes(job.state)) continue;
        if (isActive(job)) await manager.action(job.id, 'pause');
        await manager.updateJob(job.id, { scheduledAt: at });
        if (job.state !== 'QUEUED') await manager.action(job.id, 'resume');
      }
      setBulkTime(null);
      setSelection(new Set());
    });
  const moveToQueue = (queueId: string) =>
    run(async () => {
      for (const job of selectedJobs) {
        if (job.engine === 'browser' || job.queueId === queueId) continue;
        // Options can only change while a transfer is stopped; it resumes from its queue.
        const wasActive = isActive(job);
        if (wasActive) await manager.action(job.id, 'pause');
        await manager.updateJob(job.id, { queueId });
        if (wasActive) await manager.action(job.id, 'resume');
      }
      setSelection(new Set());
    });
  const title = navigation.find((item) => item.id === view)?.label || view;
  return (
    <div
      className="app-shell"
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes('text/uri-list') ||
          event.dataTransfer.types.includes('text/plain')
        )
          event.preventDefault();
      }}
      onDrop={(event) => {
        const text =
          event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
        if (/https?:\/\//i.test(text)) {
          event.preventDefault();
          setBatch(text);
        }
      }}
      onPaste={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('input,textarea,[contenteditable="true"]')) return;
        const text = event.clipboardData.getData('text/plain');
        if (/^https?:\/\//i.test(text.trim())) {
          event.preventDefault();
          setBatch(text);
        }
      }}
    >
      <aside ref={sidebarRef} className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            changeView('all');
          }}
        >
          <span className="brand-mark">
            <Zap size={24} fill="currentColor" strokeWidth={1.5} />
          </span>
          <span>
            flux<span className="brand-dot">.</span>
          </span>
        </a>
        <p className="sidebar-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'selected' : ''}`}
              onClick={() => changeView(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              <span className="nav-count">{jobs.filter((j) => matches(j, id)).length}</span>
            </button>
          ))}
        </nav>
        {snapshot.settings.categories && (
          <>
            <p className="sidebar-caption category-caption">FILE CATEGORIES</p>
            <nav aria-label="File categories">
              {(Object.entries(categoryIcons) as [Category, typeof File][]).map(
                ([category, Icon]) => (
                  <button
                    key={category}
                    className={`nav-item category-nav ${view === category ? 'selected' : ''}`}
                    onClick={() => changeView(category)}
                  >
                    <Icon size={17} />
                    <span>{category}</span>
                    {jobs.some((j) => j.category === category) && (
                      <span className="nav-count">
                        {jobs.filter((j) => j.category === category).length}
                      </span>
                    )}
                  </button>
                ),
              )}
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={19} />
            <div>
              <strong>Local by design</strong>
              <span>Your files stay on your device.</span>
            </div>
          </div>
          <button
            className={`nav-item ${view === 'settings' ? 'selected' : ''}`}
            onClick={() => changeView('settings')}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
          <div className="sidebar-version">
            <span>Flux for Chrome</span>
            <span>v0.10.0</span>
          </div>
          <p className="sidebar-credit">
            created by <strong>Vexor</strong>
          </p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileNav(!mobileNav)}
            aria-label="Toggle navigation"
          >
            <LayoutGrid size={19} />
          </button>
          <label className="global-search">
            <Search size={17} />
            <input
              ref={globalSearch}
              aria-label="Global search"
              placeholder="Search downloads, files, or folders…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                if (view === 'settings') changeView('all');
              }}
            />
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </label>
          <div className="topbar-right">
            <span className="local-indicator">
              <i /> Local engine
            </span>
            <button
              className="icon-button"
              title="Toggle theme"
              aria-label="Toggle theme"
              onClick={() =>
                run(() =>
                  manager.updateSettings({
                    ...snapshot.settings,
                    theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
                  }),
                )
              }
            >
              {snapshot.settings.theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>
        <div className="main-content">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{view === 'settings' ? 'Settings' : title}</strong>
          </nav>
          {(error || snapshot.error) && (
            <div className="global-error" role="alert">
              <CircleAlert size={18} />
              <span>{error || snapshot.error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!(bannerHidden && snapshot.settings.interception && captureAccess) && (
            <section className="capture-setup" aria-label="Automatic download capture">
              <ShieldCheck size={23} />
              <div>
                <strong>
                  {snapshot.settings.interception && captureAccess
                    ? 'Automatic capture is on'
                    : 'Let Flux handle your downloads'}
                </strong>
                <p>
                  {snapshot.settings.interception && captureAccess
                    ? 'Eligible downloads start in Flux. Files that require the original browser request stay with Chrome.'
                    : 'Enable automatic capture and approve website access so clicking a file starts Flux instead of Chrome’s default downloader.'}
                </p>
              </div>
              {(!snapshot.settings.interception || !captureAccess) && (
                <button
                  className="button primary"
                  onClick={() => run(() => manager.enableAutomaticCapture())}
                >
                  Enable automatic downloads
                </button>
              )}
              {snapshot.settings.interception && captureAccess && (
                <>
                  <span className="banner-art browser-art" aria-hidden="true">
                    <Zap size={20} fill="currentColor" />
                  </span>
                  <button
                    className="icon-button banner-close"
                    aria-label="Dismiss banner"
                    onClick={() => setBannerHidden(true)}
                  >
                    <X size={18} />
                  </button>
                </>
              )}
            </section>
          )}
          <SaveSetup
            snapshot={snapshot}
            manager={manager}
            run={run}
            onSettings={() => changeView('settings')}
          />
          {offers.length > 0 && (
            <section
              className="native-offers"
              aria-label="Browser download offers"
              aria-live="polite"
            >
              {offers.map((offer) => (
                <article className="native-offer" key={offer.id}>
                  <ArrowDownToLine size={20} aria-hidden="true" />
                  <div className="native-offer-copy">
                    <h3 title={offer.filename}>{offer.filename}</h3>
                    <p>
                      Chrome is already downloading this file. Reviewing in Flux starts a separate
                      transfer; cancel the browser download manually before switching.
                    </p>
                  </div>
                  <div className="native-offer-actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setInitialUrl(offer.url);
                        setAdd(true);
                      }}
                    >
                      Review link
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Dismiss offer for ${offer.filename}`}
                      onClick={() => run(() => dismissOffer(offer.id))}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}
          {!!snapshot.settings.trafficLimit && (
            <div className="notice" role="status">
              Download allowance: {bytes(snapshot.traffic?.used ?? 0)} /{' '}
              {bytes(snapshot.settings.trafficLimit)}
              {snapshot.traffic?.resetsAt
                ? ` · resets ${new Date(snapshot.traffic.resetsAt).toLocaleString()}`
                : ''}
            </div>
          )}
          {view === 'settings' ? (
            <Settings manager={manager} snapshot={snapshot} run={run} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR DOWNLOAD WORKSPACE</div>
                  <h1>
                    {title}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>Everything you download, beautifully under control.</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setInitialUrl('');
                    setAdd(true);
                  }}
                >
                  <Plus size={18} /> Add download
                  <ChevronDown size={17} className="button-chevron" />
                </button>
              </div>
              <div className="workspace-actions" aria-label="Download tools">
                <button
                  className="button secondary"
                  onClick={() => run(() => manager.chooseDownloadFolder())}
                >
                  <FolderOpen size={17} />
                  {snapshot.destination
                    ? `Folder: ${snapshot.destination.name}`
                    : 'Choose download folder'}
                </button>
                <button className="button secondary" onClick={() => setBatch('')}>
                  <Link2 size={17} /> Add multiple links
                </button>
                <button className="button secondary" onClick={() => setQueuesOpen(true)}>
                  <Layers size={17} /> Manage queues
                </button>
                <button
                  className="button secondary"
                  disabled={mediaBusy}
                  onClick={() => void grabLinks()}
                >
                  <FileText size={17} /> Grab page links
                </button>
                <button
                  className="button secondary"
                  disabled={!jobs.length}
                  onClick={() =>
                    run(() => exportDownloadList(selectedJobs.length ? selectedJobs : jobs))
                  }
                >
                  <Upload size={17} /> Export link list
                </button>
              </div>
              <section className="stats-grid" aria-label="Transfer statistics">
                <div className="stat-card">
                  <div className="stat-label">
                    <span>Current speed</span>
                    <Zap size={17} />
                  </div>
                  <div className="stat-value accent-text">
                    {bytes(speed)}
                    <small>/s</small>
                  </div>
                  <span className="stat-foot">
                    <span className={`live-dot ${active.length ? 'live' : ''}`} />
                    {active.length ? 'Live transfer speed' : 'Ready when you are'}
                  </span>
                  <svg className="stat-art wave" viewBox="0 0 120 40" aria-hidden="true">
                    <path d="M0 30 C15 10 25 34 40 22 S65 6 80 18 S105 8 120 14" />
                  </svg>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    <span>In progress</span>
                    <Clock3 size={17} />
                  </div>
                  <div className="stat-value">
                    {active.length.toString().padStart(2, '0')}
                    <small>downloads</small>
                  </div>
                  <span className="stat-foot">
                    {active.reduce((n, j) => n + j.connections, 0)} active connections
                  </span>
                  <span className="stat-art bars" aria-hidden="true">
                    <i /> <i /> <i /> <i /> <i /> <i />
                  </span>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    <span>Completed</span>
                    <CircleCheckBig size={17} />
                  </div>
                  <div className="stat-value">
                    {completed.length.toString().padStart(2, '0')}
                    <small>files</small>
                  </div>
                  <span className="stat-foot">
                    {bytes(completed.reduce((n, j) => n + j.downloaded, 0))} downloaded
                  </span>
                  <span className="stat-art bars" aria-hidden="true">
                    <i /> <i /> <i /> <i /> <i /> <i />
                  </span>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    <span>Local storage</span>
                    <Database size={17} />
                  </div>
                  <div className="stat-value">
                    {snapshot.storage ? bytes(snapshot.storage.usage) : '—'}
                  </div>
                  <span className="stat-foot">
                    {snapshot.storage
                      ? `${bytes(snapshot.storage.quota)} browser quota`
                      : 'Stored privately in your browser'}
                  </span>
                  <span className="stat-meter" aria-hidden="true">
                    <i
                      style={{
                        width: `${snapshot.storage ? Math.min(100, (snapshot.storage.usage / Math.max(1, snapshot.storage.quota)) * 100) : 0}%`,
                      }}
                    />
                    <b>
                      {snapshot.storage
                        ? Math.round(
                            (snapshot.storage.usage / Math.max(1, snapshot.storage.quota)) * 100,
                          )
                        : 0}
                      %
                    </b>
                  </span>
                </div>
              </section>
              <section className="downloads-section">
                <div className="section-heading">
                  <div className="downloads-title">
                    <h2>{view === 'all' ? 'Your downloads' : title}</h2>
                    <span className="count-badge">{visible.length}</span>
                  </div>
                  <div className="toolbar">
                    <button
                      className="button secondary tool"
                      onClick={() => run(() => manager.pauseAll())}
                      disabled={!active.length && !jobs.some((job) => job.queueRetryAt != null)}
                    >
                      <Pause size={15} /> Pause all
                    </button>
                    <button
                      className="button secondary tool"
                      onClick={() => run(() => manager.resumeAll())}
                      disabled={
                        !jobs.some((j) =>
                          ['PAUSED', 'FAILED', 'WAITING_FOR_NETWORK'].includes(j.state),
                        )
                      }
                    >
                      <Play size={15} /> Resume all
                    </button>
                    <button
                      className="icon-button"
                      title="Find direct media in the active web page"
                      aria-label="Find media in active tab"
                      onClick={() => void detect()}
                      disabled={mediaBusy}
                    >
                      {mediaBusy ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <Radio size={17} />
                      )}
                    </button>
                  </div>
                </div>
                <div className="list-controls">
                  <label className="search-box">
                    <Search size={17} />
                    <input
                      placeholder="Search downloads…"
                      aria-label="Search downloads"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    {search && (
                      <button
                        className="icon-button"
                        aria-label="Clear search"
                        onClick={() => setSearch('')}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  <div className="filter-controls">
                    <label className="select-control">
                      <select
                        aria-label="Filter by queue"
                        value={queueFilter}
                        onChange={(event) => setQueueFilter(event.target.value)}
                      >
                        <option value="all">All queues</option>
                        <option value="default">Default queue</option>
                        {snapshot.settings.queues.map((queue) => (
                          <option key={queue.id} value={queue.id}>
                            {queue.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="select-control">
                      <ListFilter size={15} />
                      <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value)}
                        aria-label="Filter by status"
                      >
                        <option value="all">All statuses</option>
                        {[
                          'DOWNLOADING',
                          'QUEUED',
                          'PAUSED',
                          'ASSEMBLING',
                          'COMPLETED',
                          'FAILED',
                          'CANCELED',
                        ].map((state) => (
                          <option key={state} value={state}>
                            {stateLabel(state)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="select-control">
                      <SlidersHorizontal size={15} />
                      <select
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                        aria-label="Sort downloads"
                      >
                        <option value="newest">Newest first</option>
                        <option value="name">Name</option>
                        <option value="size">File size</option>
                        <option value="priority">Priority & queue</option>
                      </select>
                    </label>
                  </div>
                </div>
                {!!visible.length && (
                  <div className="bulk-toolbar" aria-label="Selected downloads">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        aria-label="Select all visible downloads"
                        checked={visible.every((job) => selection.has(job.id))}
                        onChange={(event) =>
                          event.target.checked ? selectAll() : setSelection(new Set())
                        }
                      />{' '}
                      {selectedJobs.length} selected
                    </label>
                    {!!selectedJobs.length && (
                      <>
                        <button className="text-button" onClick={() => bulk('pause')}>
                          Pause selected
                        </button>
                        <button className="text-button" onClick={() => bulk('resume')}>
                          Resume selected
                        </button>
                        <button className="text-button" onClick={() => bulk('cancel')}>
                          Cancel selected
                        </button>
                        <button className="text-button danger-text" onClick={() => bulk('remove')}>
                          Remove selected
                        </button>
                        <span className="bulk-divider" />
                        <button className="text-button" onClick={() => bulk('start')}>
                          <Play size={14} /> Start now
                        </button>
                        <select
                          className="bulk-select"
                          aria-label="Move selected to queue"
                          value=""
                          onChange={(event) =>
                            event.target.value === 'new'
                              ? setQueuesOpen(true)
                              : moveToQueue(event.target.value)
                          }
                        >
                          <option value="" disabled>
                            Move to queue…
                          </option>
                          <option value="default">Default queue</option>
                          {snapshot.settings.queues.map((queue) => (
                            <option key={queue.id} value={queue.id}>
                              {queue.name}
                            </option>
                          ))}
                          <option value="new">+ New queue…</option>
                        </select>
                        {bulkTime === null ? (
                          <button className="text-button" onClick={() => setBulkTime(nextHour())}>
                            <Clock3 size={14} /> Start at…
                          </button>
                        ) : (
                          <span className="bulk-time">
                            <input
                              type="datetime-local"
                              aria-label="Start selected at"
                              value={bulkTime}
                              onChange={(event) => setBulkTime(event.target.value)}
                            />
                            <button
                              className="button primary small"
                              disabled={!bulkTime}
                              onClick={() => scheduleSelected(new Date(bulkTime).getTime())}
                            >
                              Set
                            </button>
                            <button className="text-button" onClick={() => setBulkTime(null)}>
                              Cancel
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div className="download-list">
                  {!snapshot.ready ? (
                    <div className="empty-state">
                      <LoaderCircle className="spin" size={30} />
                      <h3>Opening your workspace</h3>
                      <p>Restoring download records from this browser.</p>
                    </div>
                  ) : visible.length ? (
                    visible.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        selected={selection.has(job.id)}
                        queue={snapshot.settings.queues.find((queue) => queue.id === job.queueId)}
                        onSelect={(checked) =>
                          setSelection((previous) => {
                            const next = new Set(previous);
                            if (checked) next.add(job.id);
                            else next.delete(job.id);
                            return next;
                          })
                        }
                        onDetails={() => setSelected(job.id)}
                        action={(value) => run(() => manager.action(job.id, value))}
                        exportFile={() => run(() => manager.exportFile(job.id))}
                      />
                    ))
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">
                        <FolderDown size={36} strokeWidth={1.3} />
                      </div>
                      <h3>
                        {search || statusFilter !== 'all'
                          ? 'No matching downloads'
                          : view === 'all'
                            ? 'Your next download starts here'
                            : `No ${title.toLowerCase()} yet`}
                      </h3>
                      <p>
                        {search || statusFilter !== 'all'
                          ? 'Try another search or choose a different filter.'
                          : 'Add a direct file link. Flux takes care of the rest.'}
                      </p>
                      {!search && statusFilter === 'all' && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            setInitialUrl('');
                            setAdd(true);
                          }}
                        >
                          <Plus size={16} /> Add your first download
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </section>
              <div className="workspace-note">
                <span>
                  <ShieldCheck size={14} /> Private. Local. No account required.
                </span>
                <span>Keep this tab open while transfers are running.</span>
              </div>
            </>
          )}
        </div>
      </main>
      {add && (
        <AddDownload
          key={initialUrl}
          initialUrl={initialUrl}
          initialMedia={initialMedia}
          manager={manager}
          onClose={() => {
            setAdd(false);
            setInitialMedia(undefined);
            if (location.hash === '#add')
              history.replaceState(null, '', location.pathname + location.search);
          }}
        />
      )}
      {batch !== null && (
        <BatchDownloads manager={manager} initialText={batch} onClose={() => setBatch(null)} />
      )}
      {queuesOpen && <Queues manager={manager} onClose={() => setQueuesOpen(false)} />}
      {selectedJob && (
        <Details job={selectedJob} manager={manager} onClose={() => setSelected(null)} run={run} />
      )}{' '}
      {media && (
        <Modal title="Media on this page" onClose={() => setMedia(null)}>
          <div className="form-stack media-list">
            <p className="muted">
              Direct media files and HLS playlists found in this page. Review an HLS rendition
              before downloading. DRM is unsupported.
            </p>
            {media.length ? (
              media.map((item, index) => (
                <div className="media-item" key={`${item.url}-${index}`}>
                  <div>
                    <strong>{item.filename}</strong>
                    <small>{hostname(item.url)}</small>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() =>
                      run(async () => {
                        if (item.media === 'hls') {
                          setInitialUrl(item.url);
                          setInitialMedia('hls');
                          setMedia(null);
                          setAdd(true);
                          return;
                        }
                        await manager.add(item);
                        setMedia((items) => items?.filter((value) => value !== item) ?? []);
                      })
                    }
                  >
                    <Plus size={15} /> {item.media === 'hls' ? 'Review HLS' : 'Add'}
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state compact">
                <Video size={28} />
                <h3>No media found</h3>
                <p>
                  Play a video on the website, then try again. You can also paste a playlist URL in
                  Add download.
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
