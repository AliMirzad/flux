import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDownToLine,
  CalendarDays,
  ClipboardPaste,
  ExternalLink,
  Folder,
  LayoutGrid,
  Link2,
  Settings,
  SlidersHorizontal,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import type { ManagerAPI } from '../../application/contracts';
import { defaultSettings, type Category } from '../../domain/model';
import { validateUrl } from '../../shared/security';
import { sanitizeFilename } from '../../shared/files';
import type { HlsReview } from '../../engine/media/types';
import type { HlsAudio } from '../../engine/media/hls';
import type { DashReview, DashSelection } from '../../engine/media/dash';
import { HostPermissionError } from '../../engine/network/policy';

type Tab = 'general' | 'advanced' | 'schedule';
const tabs: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'general', label: 'General', Icon: SlidersHorizontal },
  { id: 'advanced', label: 'Advanced', Icon: Settings },
  { id: 'schedule', label: 'Schedule', Icon: CalendarDays },
];
const categories = Object.keys(defaultSettings.categoryFolders) as Category[];
const SITE_KEY = 'flux.siteSettings';
const audioName = (choice: HlsAudio) =>
  (choice.name + (choice.language ? ` (${choice.language})` : ''))
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, 256);
interface SiteSettings {
  split: boolean;
  connections: number;
  mode: 'auto' | 'manual';
  speed: string;
  unit: 'KB' | 'MB';
}
function siteHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}
function readSites(): Record<string, SiteSettings> {
  try {
    return JSON.parse(localStorage.getItem(SITE_KEY) ?? '{}') as Record<string, SiteSettings>;
  } catch {
    return {};
  }
}
function soon() {
  const at = new Date(Date.now() + 3600000);
  at.setMinutes(0, 0, 0);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function Shell({
  embedded,
  onClose,
  children,
}: {
  embedded?: { onCancel: () => void };
  onClose: () => void;
  children: ReactNode;
}) {
  return embedded ? (
    <div className="embedded-dialog">
      <header className="modal-header">
        <h2>
          <Zap size={20} aria-hidden="true" />
          Add Download
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={embedded.onCancel}
        >
          <X size={19} />
        </button>
      </header>
      {children}
    </div>
  ) : (
    <Modal title="Add Download" onClose={onClose}>
      {children}
    </Modal>
  );
}
export function AddDownload({
  manager,
  onClose,
  initialUrl = '',
  initialMedia,
  initialFilename = '',
  embedded,
}: {
  manager: ManagerAPI;
  onClose: () => void;
  initialUrl?: string;
  initialMedia?: 'hls' | 'dash';
  initialFilename?: string;
  /** Rendered inside the toolbar popup: no modal, no HLS review, and Cancel discards the capture. */
  embedded?: { onCancel: () => void };
}) {
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const destination =
    snapshot.settings.saveLocation === 'folder' ? snapshot.destination : undefined;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const addOnly = useRef(false);
  const inspection = useRef<AbortController | null>(null);
  const [kind, setKind] = useState<'file' | 'hls' | 'dash'>(initialMedia ?? 'file');
  const [dashReview, setDashReview] = useState<DashReview | null>(null);
  const [dashSelection, setDashSelection] = useState<DashSelection | undefined>();
  const [review, setReview] = useState<HlsReview | null>(null);
  const [variant, setVariant] = useState('');
  const [audioChoice, setAudioChoice] = useState('');
  const [audioLabel, setAudioLabel] = useState('');
  const [grant, setGrant] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialMedia ? 'advanced' : 'general');
  const [url, setUrl] = useState(initialUrl);
  const [category, setCategory] = useState('');
  const [startNow, setStartNow] = useState(true);
  const [scheduled, setScheduled] = useState(false);
  const [split, setSplit] = useState(true);
  const [connections, setConnections] = useState(snapshot.settings.maxConnections || 8);
  const [mode, setMode] = useState<'auto' | 'manual'>(snapshot.settings.mode);
  const [speed, setSpeed] = useState('0');
  const [unit, setUnit] = useState<'KB' | 'MB'>('KB');
  const [remember, setRemember] = useState(false);
  const [useBrowserCookies, setUseBrowserCookies] = useState(true);
  const [recordingMinutes, setRecordingMinutes] = useState('30');
  useEffect(() => () => inspection.current?.abort(), []);
  useEffect(() => {
    const saved = readSites()[siteHost(initialUrl)];
    if (saved) applySite(saved);
    // Only the dialog's first URL restores remembered settings on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function applySite(saved: SiteSettings) {
    setSplit(saved.split);
    setConnections(saved.connections);
    setMode(saved.mode);
    setSpeed(saved.speed);
    setUnit(saved.unit);
    setRemember(true);
  }
  function changeUrl(value: string) {
    inspection.current?.abort();
    setBusy(false);
    setReview(null);
    setDashReview(null);
    setDashSelection(undefined);
    setAudioChoice('');
    setAudioLabel('');
    setGrant(null);
    setUrl(value);
    const saved = readSites()[siteHost(value)];
    if (saved) applySite(saved);
  }
  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) changeUrl(text);
    } catch {
      setError('Allow clipboard access, or paste the link with Ctrl+V.');
    }
  }
  async function chooseFolder() {
    setError('');
    try {
      await manager.chooseDownloadFolder();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function preview(target?: string, origin?: string, selectedAudio?: string) {
    setBusy(true);
    setError('');
    setGrant(null);
    inspection.current?.abort();
    const controller = new AbortController();
    inspection.current = controller;
    try {
      if (origin && !(await chrome.permissions.request({ origins: [origin + '/*'] })))
        throw new Error('Website access was declined.');
      const input = formRef.current!.querySelector<HTMLInputElement>('[name="url"]')!;
      if (kind === 'dash') {
        const result = await manager.inspectDash(
          (target ?? input.value).trim(),
          controller.signal,
          dashSelection,
          useBrowserCookies,
        );
        if (controller.signal.aborted) return;
        setUrl(result.url);
        setDashReview(result);
        setDashSelection(result.selection);
        return;
      }
      const result = await manager.inspectHls(
        (target ?? input.value).trim(),
        controller.signal,
        selectedAudio,
        useBrowserCookies,
      );
      if (controller.signal.aborted) return;
      setUrl(result.url);
      setReview(result);
      if (result.kind === 'master') {
        const first = result.variants[0];
        setVariant(first?.url ?? '');
        const choices = result.audio.filter((item) => item.group === first?.audioGroup);
        const selected = choices.find((item) => item.default) ?? choices[0];
        setAudioChoice(selected?.url ?? '');
        setAudioLabel(selected ? audioName(selected) : '');
      } else setAudioChoice(result.audioUrl ?? '');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      if (cause instanceof HostPermissionError) setGrant(cause.origin);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const onlyAdd = addOnly.current;
    addOnly.current = false;
    setBusy(true);
    setError('');
    try {
      const link = String(form.get('url')).trim();
      if (kind === 'hls' && (review?.kind !== 'media' || review.url !== validateUrl(link).href))
        throw new Error('Review the selected HLS rendition before adding it.');
      if (
        kind === 'dash' &&
        (!dashReview ||
          dashReview.url !== validateUrl(link).href ||
          JSON.stringify(dashReview.selection) !== JSON.stringify(dashSelection))
      )
        throw new Error('Review the selected DASH video and audio before adding it.');
      const connectionCount = split ? connections : 1;
      await manager.add({
        url: link,
        useBrowserCookies,
        media: kind === 'file' ? undefined : kind,
        recordingSeconds:
          (kind === 'hls' && review?.kind === 'media' && review.live) ||
          (kind === 'dash' && dashReview?.live)
            ? Math.round(Number(recordingMinutes) * 60)
            : undefined,
        dash: kind === 'dash' ? dashReview!.selection : undefined,
        audioUrl: kind === 'hls' && review?.kind === 'media' ? review.audioUrl : undefined,
        audioLabel:
          kind === 'hls' && review?.kind === 'media' && review.audioUrl ? audioLabel : undefined,
        filename: String(form.get('filename')).trim() || undefined,
        expectedHash: String(form.get('hash')).trim() || undefined,
        priority: Number(form.get('priority')),
        speedLimit: Number(speed) * (unit === 'MB' ? 1024 * 1024 : 1024),
        scheduledAt:
          scheduled && form.get('schedule')
            ? new Date(String(form.get('schedule'))).getTime()
            : null,
        queueId: String(form.get('queueId')),
        startPaused: onlyAdd || (!startNow && !scheduled),
        category: (category as Category) || undefined,
        maxConnections: kind !== 'file' ? undefined : connectionCount,
        mode: kind !== 'file' ? undefined : mode,
      });
      const host = siteHost(link);
      if (host) {
        try {
          const sites = readSites();
          if (remember) sites[host] = { split, connections, mode, speed, unit };
          else delete sites[host];
          localStorage.setItem(SITE_KEY, JSON.stringify(sites));
        } catch {
          // Remembered settings are a convenience; storage may be unavailable.
        }
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function useBrowser() {
    if (kind !== 'file') {
      setError(
        'Chrome would save only the playlist. Choose a supported HLS rendition for Flux assembly.',
      );
      return;
    }
    setError('');
    setBusy(true);
    try {
      const form = new FormData(formRef.current!);
      const target = validateUrl(String(form.get('url')).trim());
      if (!globalThis.chrome?.runtime?.id)
        throw new Error(
          'The browser downloader is available after installing the Flux Chrome extension.',
        );
      const filename = String(form.get('filename')).trim();
      const id = await chrome.downloads.download({
        url: target.href,
        saveAs: true,
        ...(filename ? { filename: sanitizeFilename(filename) } : {}),
      });
      const result = await chrome.runtime.sendMessage({ type: 'register-native', id });
      if (result?.error)
        throw new Error(
          'Chrome started the transfer, but Flux could not link it. Review Chrome downloads. ' +
            result.error,
        );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell embedded={embedded} onClose={onClose}>
      <form
        ref={formRef}
        onSubmit={(event) => void submit(event)}
        onInvalid={(event) => {
          const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-panel]');
          if (panel?.dataset.panel) setTab(panel.dataset.panel as Tab);
        }}
        className="form-stack add-form"
      >
        <div className="add-url">
          <div className="input-icon">
            <Link2 size={17} />
            <input
              name="url"
              type="url"
              required
              autoFocus
              aria-label="Download URL"
              value={url}
              onChange={(event) => changeUrl(event.target.value)}
              aria-describedby="download-url-help"
              placeholder="https://example.com/file.zip"
            />
            {url && (
              <button
                type="button"
                className="icon-button url-clear"
                aria-label="Clear URL"
                onClick={() => changeUrl('')}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="add-url-actions">
            <button type="button" className="button secondary" onClick={() => void paste()}>
              <ClipboardPaste size={15} /> Paste from clipboard
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              title="Add to the list without starting"
              onClick={() => {
                addOnly.current = true;
                formRef.current?.requestSubmit();
              }}
            >
              Add
            </button>
          </div>
        </div>
        <p id="download-url-help" className="sr-only">
          Review the link before downloading. If a server does not work with Flux, use the browser
          downloader on the Advanced tab.
        </p>
        <div className="tabs" role="tablist" aria-label="Download options">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              id={`add-tab-${id}`}
              aria-controls={`add-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? 'selected' : ''}
              onKeyDown={(event) => {
                const current = tabs.findIndex((item) => item.id === id);
                const index =
                  event.key === 'ArrowRight'
                    ? (current + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (current + tabs.length - 1) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : -1;
                if (index < 0) return;
                event.preventDefault();
                const next = tabs[index];
                if (!next) return;
                setTab(next.id);
                document.getElementById(`add-tab-${next.id}`)?.focus();
              }}
              onClick={() => setTab(id)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <div
          id="add-panel-general"
          role="tabpanel"
          aria-labelledby="add-tab-general"
          data-panel="general"
          hidden={tab !== 'general'}
          className="panel"
        >
          <div className="row">
            <label htmlFor="add-filename">File name</label>
            <input
              id="add-filename"
              name="filename"
              placeholder="Use the server's filename"
              defaultValue={initialFilename}
              aria-label="File name optional"
            />
          </div>
          <div className="row">
            <span className="row-label">Save to</span>
            <div className="row-pair">
              <div className="fake-input">
                <Folder size={16} />
                <span>{destination?.name ?? 'Downloads'}</span>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => void chooseFolder()}
              >
                Change
              </button>
            </div>
          </div>
          <div className="row">
            <label htmlFor="add-category">Category</label>
            <div className="input-icon">
              <LayoutGrid size={16} />
              <select
                id="add-category"
                name="category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Auto-detect</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="checks">
            <label className="check">
              <input
                type="checkbox"
                checked={startNow}
                onChange={(event) => setStartNow(event.target.checked)}
              />
              Start download immediately
            </label>
            <div className="check-line">
              <label className="check">
                <input
                  type="checkbox"
                  checked={split}
                  onChange={(event) => setSplit(event.target.checked)}
                />
                Split into multiple connections
              </label>
              <select
                aria-label="Connections"
                value={connections}
                disabled={!split}
                onChange={(event) => setConnections(Number(event.target.value))}
              >
                {[2, 4, 8, 16].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={scheduled}
                onChange={(event) => {
                  setScheduled(event.target.checked);
                  if (event.target.checked) setTab('schedule');
                }}
              />
              Schedule download
            </label>
          </div>
        </div>
        <div
          id="add-panel-advanced"
          role="tabpanel"
          aria-labelledby="add-tab-advanced"
          data-panel="advanced"
          hidden={tab !== 'advanced'}
          className="panel"
        >
          <div className="row" hidden={!!embedded}>
            <label htmlFor="add-kind">Download type</label>
            <select
              id="add-kind"
              value={kind}
              onChange={(event) => {
                inspection.current?.abort();
                setBusy(false);
                setKind(event.target.value as 'file' | 'hls' | 'dash');
                setReview(null);
                setDashReview(null);
                setDashSelection(undefined);
                setGrant(null);
              }}
            >
              <option value="file">Direct file</option>
              <option value="hls">HLS video / live recording</option>
              <option value="dash">DASH video / live recording</option>
            </select>
          </div>
          {kind === 'hls' && (
            <div className="form-stack">
              <p className="small muted">
                Review H.264/AAC HLS and choose a quality. Separate MP4 audio can be combined for
                completed media. A live rendition with audio included can be recorded for a chosen
                duration or finished manually. MP4 and continuous MPEG-TS parts produce MP4; the
                first TS part needs a keyframe. Clear or ordinary AES-128 is supported. TS parts are
                limited to 16 MiB. Completed streams support separate audio and compatible
                discontinuities; a new TS period needs a keyframe.
              </p>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void preview()}
              >
                Review HLS playlist
              </button>
              {grant && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void preview(
                      review?.kind === 'master' ? variant : undefined,
                      grant,
                      audioChoice || undefined,
                    )
                  }
                >
                  Allow stream website
                </button>
              )}
              {review?.kind === 'master' && (
                <>
                  <label>
                    Video quality
                    <select
                      value={variant}
                      onChange={(event) => {
                        const value = event.target.value;
                        setVariant(value);
                        const group = review.variants.find(
                          (item) => item.url === value,
                        )?.audioGroup;
                        const choices = review.audio.filter((item) => item.group === group),
                          selected = choices.find((item) => item.default) ?? choices[0];
                        setAudioChoice(selected?.url ?? '');
                        setAudioLabel(selected ? audioName(selected) : '');
                      }}
                    >
                      {review.variants.map((item) => (
                        <option key={item.url} value={item.url}>
                          {item.resolution ?? 'Rendition'} · {Math.round(item.bandwidth / 1000)}{' '}
                          kb/s
                          {item.externalAudio ? ' · choose audio' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {review.audio.some(
                    (item) =>
                      item.group ===
                      review.variants.find((variantOption) => variantOption.url === variant)
                        ?.audioGroup,
                  ) && (
                    <label>
                      Audio / language
                      <select
                        value={audioChoice}
                        onChange={(event) => {
                          setAudioChoice(event.target.value);
                          const choice = review.audio.find(
                            (item) => item.url === event.target.value,
                          );
                          setAudioLabel(choice ? audioName(choice) : '');
                        }}
                      >
                        {review.audio
                          .filter(
                            (item) =>
                              item.group ===
                              review.variants.find((option) => option.url === variant)?.audioGroup,
                          )
                          .map((item) => (
                            <option key={item.name} value={item.url ?? ''}>
                              {audioName(item)}
                              {item.default ? ' · default' : ''}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || !variant}
                    onClick={() => void preview(variant, undefined, audioChoice || undefined)}
                  >
                    Review selected quality
                  </button>
                </>
              )}
              {review?.kind === 'media' && (
                <>
                  {review.live && (
                    <label>
                      Recording duration (minutes)
                      <input
                        type="number"
                        min="0.017"
                        max="1440"
                        step="any"
                        value={recordingMinutes}
                        onChange={(event) => setRecordingMinutes(event.target.value)}
                      />
                      <span className="small muted">
                        Record from the available live window. Use Finish recording to save earlier.
                        Keep this manager open. A missed segment stops recording and retains
                        verified parts.
                      </span>
                    </label>
                  )}
                  <p role="status">
                    {review.parts} media parts · {review.duration.toFixed(1)} seconds. Output: MP4.
                    {review.audioUrl && (
                      <> Selected audio: {audioLabel}. Separate tracks will be combined.</>
                    )}
                    {review.encrypted &&
                      ' AES-128: public key resources will be requested with the listed website permissions. Encrypted parts are limited to 16 MiB.'}
                    Container and source identity are checked before saving.
                  </p>
                </>
              )}
            </div>
          )}
          {kind === 'dash' && (
            <div className="form-stack">
              <p className="small muted">
                Review unprotected H.264/AAC DASH. Select video quality and audio, then review the
                selection. Completed periods produce MP4; a dynamic manifest can be recorded for a
                chosen duration or finished manually.
              </p>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void preview()}
              >
                Review DASH manifest
              </button>
              {grant && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void preview(undefined, grant)}
                >
                  Allow stream website
                </button>
              )}
              {dashReview && dashSelection && (
                <>
                  {dashReview.live && (
                    <label>
                      Recording duration (minutes)
                      <input
                        type="number"
                        min="0.017"
                        max="1440"
                        step="any"
                        value={recordingMinutes}
                        onChange={(event) => setRecordingMinutes(event.target.value)}
                      />
                      <span className="small muted">
                        Keep this manager open. Finish recording saves the verified video and audio
                        already received.
                      </span>
                    </label>
                  )}
                  <label>
                    Video quality
                    <select
                      aria-label="DASH video quality"
                      value={dashSelection.videoId}
                      onChange={(event) =>
                        setDashSelection({ ...dashSelection, videoId: event.target.value })
                      }
                    >
                      {dashReview.choices
                        .filter((item) => item.kind === 'video')
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.width && item.height ? `${item.width}×${item.height}` : item.id} ·{' '}
                            {Math.round(item.bandwidth / 1000)} kb/s
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Audio / language
                    <select
                      aria-label="DASH audio language"
                      value={dashSelection.audioId ?? ''}
                      onChange={(event) =>
                        setDashSelection({ ...dashSelection, audioId: event.target.value })
                      }
                    >
                      <option value="">No external audio / use embedded audio</option>
                      {dashReview.choices
                        .filter((item) => item.kind === 'audio')
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.language ?? item.id} · {Math.round(item.bandwidth / 1000)} kb/s
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void preview()}
                  >
                    Review selected DASH tracks
                  </button>
                  {JSON.stringify(dashSelection) === JSON.stringify(dashReview.selection) && (
                    <p role="status">
                      {dashReview.parts} media parts · {dashReview.duration.toFixed(1)} seconds.
                      Output: MP4. Selected video: {dashSelection.videoId}; audio:{' '}
                      {dashSelection.audioId || 'embedded'}. Both sources are checked on resume.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          <div className="row">
            <label htmlFor="add-mode">Connection mode</label>
            <select
              id="add-mode"
              aria-describedby="connection-mode-help"
              value={mode}
              onChange={(event) => setMode(event.target.value as 'auto' | 'manual')}
            >
              <option value="auto">Adaptive (recommended)</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <p id="connection-mode-help" className="connection-help">
            {mode === 'auto'
              ? 'Adaptive adjusts the number of connections as the file downloads, up to your maximum.'
              : 'Manual uses your selected connection count when the server supports it.'}
          </p>
          <div className="row">
            <label htmlFor="add-max">Maximum connections</label>
            <select
              id="add-max"
              value={split ? connections : 1}
              onChange={(event) => {
                const n = Number(event.target.value);
                setSplit(n > 1);
                if (n > 1) setConnections(n);
              }}
            >
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <label htmlFor="add-speed">Speed limit</label>
            <div className="speed-row">
              <input
                id="add-speed"
                type="number"
                min="0"
                value={speed}
                onChange={(event) => setSpeed(event.target.value)}
              />
              <select
                aria-label="Speed unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value as 'KB' | 'MB')}
              >
                <option value="KB">KB/s</option>
                <option value="MB">MB/s</option>
              </select>
              <span className="muted small">(0 = unlimited)</span>
            </div>
          </div>
          <div className="row">
            <span className="row-label">Use browser cookies</span>
            <span
              className="switch-static"
              title="Use the session only on the download URL's origin; other hosts receive no cookies."
            >
              <input
                type="checkbox"
                checked={useBrowserCookies}
                onChange={(event) => {
                  inspection.current?.abort();
                  setBusy(false);
                  setReview(null);
                  setDashReview(null);
                  setUseBrowserCookies(event.target.checked);
                }}
                aria-label="Use browser cookies"
              />
            </span>
          </div>
          <div className="row">
            <span className="row-label">Referrer</span>
            <span className="muted">Omitted</span>
          </div>
          <div className="row">
            <span className="row-label">User agent</span>
            <span className="muted">Chrome default</span>
          </div>
          <div className="row">
            <label htmlFor="add-hash">Expected SHA-256</label>
            <input
              id="add-hash"
              name="hash"
              minLength={64}
              maxLength={64}
              pattern="[a-fA-F0-9]{64}"
              placeholder="optional · 64-character checksum"
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            className="text-button browser-fallback"
            onClick={() => void useBrowser()}
            disabled={busy || kind !== 'file'}
          >
            <ExternalLink size={14} /> Use browser
          </button>
        </div>
        <div
          id="add-panel-schedule"
          role="tabpanel"
          aria-labelledby="add-tab-schedule"
          data-panel="schedule"
          hidden={tab !== 'schedule'}
          className="panel"
        >
          <div className="row">
            <label htmlFor="add-queue">Download queue</label>
            <select id="add-queue" name="queueId" defaultValue="default">
              <option value="default">Default queue</option>
              {snapshot.settings.queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <label htmlFor="add-priority">Priority</label>
            <select id="add-priority" name="priority" defaultValue="0">
              <option value="2">High</option>
              <option value="0">Normal</option>
              <option value="-2">Low</option>
            </select>
          </div>
          <div className="checks">
            <label className="check">
              <input
                type="checkbox"
                checked={scheduled}
                onChange={(event) => setScheduled(event.target.checked)}
              />
              Schedule download
            </label>
          </div>
          {scheduled && (
            <div className="row">
              <label htmlFor="add-time">Start time</label>
              <input
                id="add-time"
                name="schedule"
                type="datetime-local"
                required
                defaultValue={soon()}
              />
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <footer className="modal-footer add-footer">
          <label className="remember">
            <Settings size={16} />
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember my settings for this site
          </label>
          <button
            type="button"
            className="button secondary"
            onClick={embedded ? embedded.onCancel : onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            <ArrowDownToLine size={16} />
            {busy ? 'Working…' : 'Start Download'}
          </button>
        </footer>
      </form>
    </Shell>
  );
}
