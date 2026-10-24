import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  Clock3,
  Database,
  Folder,
  FolderOpen,
  Globe,
  HardDrive,
  Link2,
  Palette,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Gauge,
  Wifi,
  Layers,
  Archive,
  AudioLines,
  FileText,
  File,
  Image,
  LayoutGrid,
  Video,
  Volume2,
  Bell,
  Zap,
} from 'lucide-react';
import type { ManagerAPI } from '../../application/contracts';
import {
  defaultSettings,
  type Category,
  type Settings as SettingsModel,
  type Snapshot,
} from '../../domain/model';
import { folderSegments } from '../../shared/files';
import { bytes } from '../components/format';
const categoryNames = Object.keys(defaultSettings.categoryFolders) as Category[];
const categoryIcons = {
  Documents: FileText,
  Archives: Archive,
  Videos: Video,
  Audio: AudioLines,
  Images: Image,
  Software: LayoutGrid,
  Other: File,
};
export function Settings({
  manager,
  snapshot,
  run,
}: {
  manager: ManagerAPI;
  snapshot: Snapshot;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [origins, setOrigins] = useState<string[]>([]);
  const [integration, setIntegration] = useState<{
    version: string;
    enabled: boolean;
    websiteAccess: boolean;
    registered: boolean;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [integrationError, setIntegrationError] = useState('');
  async function checkIntegration(reconnect = false) {
    setChecking(true);
    setIntegrationError('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!globalThis.chrome?.runtime?.id)
        throw new Error('Open the installed Chrome extension to check download integration.');
      const reply = await Promise.race([
        chrome.runtime.sendMessage({ type: 'integration-status', reconnect }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'The extension background did not respond. Reload the existing Flux card in chrome://extensions.',
                ),
              ),
            7000,
          );
        }),
      ]);
      if (reply?.error) throw new Error(reply.error);
      if (!reply?.version)
        throw new Error(
          'The loaded extension is outdated or did not respond. Reload the existing Flux card in chrome://extensions.',
        );
      setIntegration(reply);
    } catch (cause) {
      setIntegrationError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      clearTimeout(timer);
      setChecking(false);
    }
  }
  useEffect(() => {
    if (globalThis.chrome?.runtime?.id)
      void chrome.permissions
        .getAll()
        .then((value) => setOrigins(value.origins ?? []))
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  const settings = snapshot.settings;
  const [limitHours, setLimitHours] = useState(!!settings.windowStart || !!settings.windowEnd);
  const [retryOn, setRetryOn] = useState(settings.retryAttempts > 0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaved(false);
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const updated: SettingsModel = {
      ...settings,
      maxActive: Number(data.get('maxActive')),
      perHost: Number(data.get('perHost')),
      maxConnections: Number(data.get('maxConnections')),
      globalLimit: Number(data.get('globalLimit')) * 1024,
      mode: data.get('mode') as SettingsModel['mode'],
      theme: data.get('theme') as SettingsModel['theme'],
      recovery: data.get('recovery') as SettingsModel['recovery'],
      retentionDays: Number(data.get('retentionDays')),
      interception: data.has('interception'),
      askQueue: data.has('askQueue'),
      confirmCapture: data.has('confirmCapture'),
      notifications: data.has('notifications'),
      categories: data.has('categories'),
      autoSave: data.has('autoSave'),
      saveByCategory: data.has('saveByCategory'),
      saveLocation: data.get('saveLocation') === 'folder' ? 'folder' : 'downloads',
      downloadsSubfolder: folderSegments(String(data.get('downloadsSubfolder') ?? '')).join('/'),
      categoryFolders: Object.fromEntries(
        categoryNames.map((category) => [
          category,
          folderSegments(String(data.get(`categoryFolder-${category}`) ?? '')).join('/') ||
            defaultSettings.categoryFolders[category],
        ]),
      ) as SettingsModel['categoryFolders'],
      completionSound: data.has('completionSound'),
      trafficLimit: Number(data.get('trafficLimit')) * 1024 * 1024,
      trafficPeriodHours: Number(data.get('trafficPeriodHours')),
      retryAttempts: retryOn ? Number(data.get('retryAttempts')) : 0,
      retryDelaySeconds: retryOn
        ? Number(data.get('retryDelaySeconds'))
        : settings.retryDelaySeconds,
      excludedHosts: String(data.get('excludedHosts'))
        .split(/[\s,]+/)
        .filter(Boolean),
      fileExtensions: String(data.get('fileExtensions'))
        .split(/[\s,]+/)
        .map((s) => s.replace(/^\./, '').toLowerCase())
        .filter(Boolean),
      windowStart: limitHours ? String(data.get('windowStart')) : '',
      windowEnd: limitHours ? String(data.get('windowEnd')) : '',
    };
    try {
      await manager.updateSettings(updated);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-view">
      <div className="section-heading">
        <div>
          <h1>Settings</h1>
          <p>Make Flux work your way.</p>
        </div>
      </div>
      <nav className="settings-navigation" aria-label="Settings sections">
        <a href="#settings-transfers">Transfers</a>
        <a href="#settings-schedule">Scheduling</a>
        <a href="#settings-saving">Saving &amp; folders</a>
        <a href="#settings-browser">Browser integration</a>
        <a href="#settings-appearance">Appearance</a>
        <a href="#settings-storage">Storage &amp; access</a>
      </nav>
      <section className="settings-section" aria-label="Download integration check">
        <div>
          <h3>
            <span className="section-icon">
              <Link2 size={18} />
            </span>
            Download integration
          </h3>
          <p>Check the loaded extension and reconnect link capture in open website tabs.</p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className="button secondary"
            disabled={checking}
            onClick={() => void checkIntegration()}
          >
            Check download integration
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={checking}
            onClick={() => void checkIntegration(true)}
          >
            Reconnect link capture
          </button>
        </div>
        {integration && (
          <p role="status">
            Loaded version: {integration.version}. Background: responding. Automatic capture:{' '}
            {integration.enabled ? 'on' : 'off'}. Website access:{' '}
            {integration.websiteAccess ? 'granted' : 'needed'}. Link listener:{' '}
            {integration.registered ? 'registered' : 'not registered'}.
          </p>
        )}
        {integration && (!integration.enabled || !integration.websiteAccess) && (
          <p className="small muted">
            Use Enable automatic downloads on the main page to turn capture on and approve website
            access.
          </p>
        )}
        {integrationError && (
          <p role="alert" className="error-message">
            {integrationError}
          </p>
        )}
      </section>
      <form
        className="settings-form"
        onSubmit={(event) => void submit(event)}
        key={JSON.stringify(settings)}
      >
        <section className="settings-section" id="settings-allowance">
          <div>
            <h3>
              <span className="section-icon">
                <Database size={18} />
              </span>
              Download allowance
            </h3>
            <p>
              Pause Flux transfers after a fixed payload allowance, then resume at the next reset.
              Browser-managed downloads use Chrome's own controls.
            </p>
          </div>
          <div className="form-grid">
            <label>
              Allowance (MiB, 0 = unlimited)
              <input
                name="trafficLimit"
                type="number"
                min="0"
                step="1"
                defaultValue={settings.trafficLimit / (1024 * 1024)}
              />
            </label>
            <label>
              Reset interval (hours)
              <input
                name="trafficPeriodHours"
                type="number"
                min="1"
                max="168"
                step="1"
                defaultValue={settings.trafficPeriodHours}
              />
            </label>
          </div>
          <p className="small muted">
            The allowance counts authorized payload ranges and up to 1 MiB of reserved credit.
            Interrupted attempts can consume allowance before all bytes arrive. Browser buffering,
            headers and other apps' traffic are outside this counter.
          </p>
        </section>
        <section className="settings-section transfer-settings" id="settings-transfers">
          <div>
            <h3>
              <span className="section-icon">
                <SlidersHorizontal size={18} />
              </span>
              Transfer preferences
            </h3>
            <p>Control concurrency and bandwidth.</p>
          </div>
          <div className="form-grid">
            <label>
              Simultaneous downloads
              <input
                name="maxActive"
                type="number"
                min="1"
                max="8"
                defaultValue={settings.maxActive}
              />
            </label>
            <label>
              Connections per host
              <input
                name="perHost"
                type="number"
                min="1"
                max="16"
                defaultValue={settings.perHost}
              />
            </label>
          </div>
          <div className="connection-controls">
            <label className="connection-card">
              <span className="connection-card-heading">
                <Wifi size={22} />
                <span>
                  Connection mode<small>How Flux connects to download files.</small>
                </span>
              </span>
              <span className="sr-only">Connection mode</span>
              <select name="mode" defaultValue={settings.mode} aria-label="Connection mode">
                <option value="auto">Adaptive · recommended</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="connection-card">
              <span className="connection-card-heading">
                <Layers size={22} />
                <span>
                  Maximum connections<small>Simultaneous connections for each file.</small>
                </span>
              </span>
              <select
                name="maxConnections"
                defaultValue={settings.maxConnections}
                aria-label="Maximum connections"
              >
                {[1, 2, 4, 8, 16].map((n) => (
                  <option key={n} value={n}>
                    {n} connection{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>
            <label className="connection-card">
              <span className="connection-card-heading">
                <Gauge size={22} />
                <span>
                  Global speed limit<small>KB/s · Set to 0 for unlimited speed.</small>
                </span>
              </span>
              <input
                aria-label="Global speed limit"
                name="globalLimit"
                type="number"
                min="0"
                defaultValue={settings.globalLimit / 1024}
              />
            </label>
          </div>
        </section>
        <section className="settings-section" id="settings-schedule">
          <div>
            <h3>
              <span className="section-icon">
                <Clock3 size={18} />
              </span>
              Scheduling &amp; recovery
            </h3>
            <p>When Flux may download, and what happens after a failure or a restart.</p>
          </div>
          <div className="form-stack schedule-settings">
            <div className="choice-group" role="radiogroup" aria-label="Download hours">
              <strong>Download hours</strong>
              <label className="choice">
                <input
                  type="radio"
                  name="hoursMode"
                  checked={!limitHours}
                  onChange={() => setLimitHours(false)}
                />
                <span>
                  Any time
                  <small>Downloads start as soon as they are added.</small>
                </span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="hoursMode"
                  checked={limitHours}
                  onChange={() => setLimitHours(true)}
                />
                <span>
                  Only during certain hours
                  <small>For example at night. Outside these hours downloads wait.</small>
                </span>
              </label>
              {limitHours && (
                <div className="inline-fields">
                  <label>
                    From
                    <input
                      name="windowStart"
                      type="time"
                      required
                      defaultValue={settings.windowStart || '00:00'}
                    />
                  </label>
                  <label>
                    To
                    <input
                      name="windowEnd"
                      type="time"
                      required
                      defaultValue={settings.windowEnd || '07:00'}
                    />
                  </label>
                </div>
              )}
            </div>
            <label className="switch-row">
              <span>
                <strong>Show the Add Download window for captured links</strong>
                <small>
                  Clicking a download link opens Flux's Add Download window first, so you can check
                  the file and options, then press Start Download.
                </small>
              </span>
              <input
                name="confirmCapture"
                type="checkbox"
                defaultChecked={settings.confirmCapture}
              />
            </label>
            <label className="switch-row">
              <span>
                <strong>Ask which queue before each download</strong>
                <small>
                  When you have queues, the Flux popup asks where a new download goes before it
                  starts.
                </small>
              </span>
              <input name="askQueue" type="checkbox" defaultChecked={settings.askQueue} />
            </label>
            <label className="switch-row">
              <span>
                <strong>Retry failed downloads automatically</strong>
                <small>
                  For temporary network or server errors. Login, missing-file and storage errors
                  still need you.
                </small>
              </span>
              <input
                type="checkbox"
                checked={retryOn}
                onChange={(event) => setRetryOn(event.target.checked)}
              />
            </label>
            {retryOn && (
              <div className="inline-fields">
                <label>
                  Retry attempts
                  <input
                    name="retryAttempts"
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    defaultValue={settings.retryAttempts || 3}
                  />
                </label>
                <label>
                  First retry after (seconds)
                  <input
                    name="retryDelaySeconds"
                    type="number"
                    min={1}
                    max={86400}
                    step={1}
                    defaultValue={settings.retryDelaySeconds}
                  />
                </label>
              </div>
            )}
            {retryOn && (
              <p className="small muted">
                The wait doubles after each attempt. Pausing a download stops its retries.
              </p>
            )}
            <label>
              When Flux reopens after being closed mid-download
              <select name="recovery" defaultValue={settings.recovery}>
                <option value="ask">Keep downloads paused until I resume them</option>
                <option value="auto">Continue downloads automatically</option>
              </select>
            </label>
          </div>
        </section>
        <section className="settings-section" id="settings-saving">
          <div>
            <h3>
              <span className="section-icon">
                <FolderOpen size={18} />
              </span>
              Saving &amp; categories
            </h3>
            <p>
              Finished files are sorted into a folder per category, like Compressed, Video and
              Programs.
            </p>
          </div>
          <div className="form-stack">
            <label className="switch-row">
              <span>
                <strong>Automatically save finished downloads</strong>
                <small>Turn off to save each verified file yourself with Save file.</small>
              </span>
              <input name="autoSave" type="checkbox" defaultChecked={settings.autoSave} />
            </label>
            <label className="switch-row">
              <span>
                <strong>Save into category folders</strong>
                <small>Each file goes into the folder for its category, named below.</small>
              </span>
              <input
                name="saveByCategory"
                type="checkbox"
                defaultChecked={settings.saveByCategory}
              />
            </label>
            <div className="form-grid">
              <label>
                Save location
                <select name="saveLocation" defaultValue={settings.saveLocation}>
                  <option value="downloads">Chrome Downloads folder</option>
                  <option value="folder" disabled={!snapshot.destination}>
                    {snapshot.destination
                      ? `Chosen folder: ${snapshot.destination.name}`
                      : 'Chosen folder (choose one below first)'}
                  </option>
                </select>
              </label>
              <label>
                Subfolder in Downloads <span className="optional">optional, e.g. Flux</span>
                <input
                  name="downloadsSubfolder"
                  defaultValue={settings.downloadsSubfolder}
                  placeholder="Save directly in Downloads"
                />
              </label>
            </div>
            <div className="form-grid">
              {categoryNames.map((category) => {
                const Icon = categoryIcons[category];
                return (
                  <label
                    key={category}
                    className={`category-folder-field ${category.toLowerCase()}`}
                  >
                    <span className="category-folder-label">
                      <span className="category-folder-icon">
                        <Icon size={19} />
                      </span>
                      {category} folder
                    </span>
                    <input
                      name={`categoryFolder-${category}`}
                      defaultValue={settings.categoryFolders[category]}
                      placeholder={defaultSettings.categoryFolders[category]}
                    />
                  </label>
                );
              })}
            </div>
            <div className="notice">
              <span>
                If a save dialog still appears after each download, turn off{' '}
                <strong>Ask where to save each file before downloading</strong> in your browser’s
                download settings (Brave turns it on by default), or choose a download folder below.
              </span>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  run(() => chrome.tabs.create({ url: 'chrome://settings/downloads' }))
                }
              >
                Open browser download settings
              </button>
            </div>
            <p className="small muted">
              The Downloads folder is the one set in Chrome's settings
              (chrome://settings/downloads); change it there to move everything. To save somewhere
              else, use Choose download folder below. Files Chrome downloads itself always use the
              Downloads folder.
            </p>
          </div>
        </section>
        <section className="settings-section" id="settings-browser">
          <div>
            <h3>
              <span className="section-icon">
                <Globe size={18} />
              </span>
              Browser integration
            </h3>
            <p>Eligible direct HTTP links only. Host access is requested when a URL needs it.</p>
          </div>
          <div className="form-stack">
            <label className="switch-row">
              <span>
                <strong>
                  <Volume2 size={17} /> Completion sound
                </strong>
                <small>
                  Play a short local tone when a transfer is verified. Use Test completion sound
                  after reopening if Chrome suspends audio.
                </small>
              </span>
              <input
                name="completionSound"
                type="checkbox"
                defaultChecked={settings.completionSound}
              />
            </label>
            <button
              type="button"
              className="button secondary align-start"
              onClick={() => run(() => manager.previewCompletionSound())}
            >
              Test completion sound
            </button>
            <label className="switch-row">
              <span>
                <strong>
                  <Zap size={17} /> Automatically capture downloads
                </strong>
                <small>
                  Eligible file links start in Flux. Enabling requests website access and also works
                  in already open tabs.
                </small>
              </span>
              <input name="interception" type="checkbox" defaultChecked={settings.interception} />
            </label>
            <label className="switch-row">
              <span>
                <strong>
                  <Bell size={17} /> Completion notifications
                </strong>
                <small>Get notified when a file is ready.</small>
              </span>
              <input name="notifications" type="checkbox" defaultChecked={settings.notifications} />
            </label>
            <label>
              Excluded hosts <span className="optional">comma separated</span>
              <input
                name="excludedHosts"
                defaultValue={settings.excludedHosts.join(', ')}
                placeholder="example.com, internal.example.com"
              />
            </label>
            <label>
              Eligible file extensions
              <input name="fileExtensions" defaultValue={settings.fileExtensions.join(', ')} />
            </label>
            <div className="notice">
              <ShieldCheck size={16} /> Permissions apply to the files you choose. No URLs or file
              content are uploaded by Flux.
            </div>
          </div>
        </section>
        <section className="settings-section" id="settings-appearance">
          <div>
            <h3>
              <span className="section-icon">
                <Palette size={18} />
              </span>
              Appearance &amp; history
            </h3>
            <p>Your workspace, your preference.</p>
          </div>
          <div className="form-stack">
            <div className="form-grid">
              <label>
                Theme
                <select name="theme" aria-label="Theme" defaultValue={settings.theme}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">Follow system</option>
                </select>
              </label>
              <label>
                History retention <span className="optional">days</span>
                <input
                  name="retentionDays"
                  type="number"
                  min="1"
                  max="3650"
                  defaultValue={settings.retentionDays}
                />
              </label>
            </div>
            <label className="switch-row">
              <span>
                <strong>Organize by category</strong>
                <small>Show file categories in the sidebar.</small>
              </span>
              <input name="categories" type="checkbox" defaultChecked={settings.categories} />
            </label>
          </div>
        </section>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="save-bar">
          {saved && (
            <span className="success">
              <Check size={16} /> Preferences saved
            </span>
          )}
          <button className="button primary" disabled={busy}>
            <Save size={16} />
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>
      <section className="storage-settings" id="settings-storage">
        <div>
          <h3>
            <span className="section-icon">
              <Folder size={18} />
            </span>
            Download folder
          </h3>
          <p>
            {snapshot.destination
              ? `${snapshot.destination.name}${snapshot.destination.authorized ? '' : ' — choose again to restore access'}`
              : 'Optional: choose any folder instead of Chrome’s Downloads folder.'}{' '}
            Category folders are created inside it. Existing filenames receive a numbered suffix.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => run(() => manager.chooseDownloadFolder())}
        >
          Choose download folder
        </button>
      </section>
      <section className="storage-settings">
        <div>
          <h3>
            <span className="section-icon">
              <Globe size={18} />
            </span>
            Website access
          </h3>
          <p>Access is requested when you add a URL. Manage the websites Flux can download from.</p>
        </div>
        {origins.length ? (
          <div className="permission-list">
            {origins.map((origin) => (
              <div key={origin}>
                <code>{origin}</code>
                <button
                  className="text-button danger-text"
                  onClick={() =>
                    run(async () => {
                      const removed = await chrome.permissions.remove({ origins: [origin] });
                      if (!removed)
                        throw new Error(
                          'Chrome did not remove this permission. Review it in the extension settings.',
                        );
                      setOrigins((value) => value.filter((item) => item !== origin));
                    })
                  }
                >
                  Revoke access
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">No website permissions have been granted.</p>
        )}
      </section>
      <section className="storage-settings">
        <div>
          <h3>
            <span className="section-icon">
              <HardDrive size={18} />
            </span>
            Local storage
          </h3>
          <p>
            {snapshot.storage
              ? `${bytes(snapshot.storage.usage)} used of ${bytes(snapshot.storage.quota)} available quota`
              : 'Transfer data is stored locally in your browser.'}
          </p>
        </div>
        <div className="toolbar">
          <button
            className="button secondary"
            onClick={() =>
              run(async () => {
                const granted = await manager.requestPersistence();
                if (!granted)
                  throw new Error(
                    'Chrome did not grant persistent storage. Keep enough free space and retain important exported files.',
                  );
              })
            }
          >
            Protect local storage
          </button>
          <button className="button secondary" onClick={() => run(() => manager.cleanup())}>
            Clean temporary data
          </button>
          <button
            className="button danger"
            onClick={() => {
              if (window.confirm('Clear completed and canceled download history?'))
                run(() => manager.clearHistory());
            }}
          >
            Clear history
          </button>
        </div>
      </section>
    </div>
  );
}
