import { useEffect, useState, type FormEvent } from 'react';
import { Check, Save, ShieldCheck } from 'lucide-react';
import type { ManagerAPI } from '../../application/contracts';
import {
  defaultSettings,
  type Category,
  type Settings as SettingsModel,
  type Snapshot,
} from '../../domain/model';
import { folderSegments } from '../../shared/files';
import { bytes } from '../components/format';
import { Companion } from './Companion';
import { MediaInspection } from './MediaInspection';
const categoryNames = Object.keys(defaultSettings.categoryFolders) as Category[];
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
  useEffect(() => {
    if (globalThis.chrome?.runtime?.id)
      void chrome.permissions
        .getAll()
        .then((value) => setOrigins(value.origins ?? []))
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  const settings = snapshot.settings;
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
      retryAttempts: Number(data.get('retryAttempts')),
      retryDelaySeconds: Number(data.get('retryDelaySeconds')),
      excludedHosts: String(data.get('excludedHosts'))
        .split(/[\s,]+/)
        .filter(Boolean),
      fileExtensions: String(data.get('fileExtensions'))
        .split(/[\s,]+/)
        .map((s) => s.replace(/^\./, '').toLowerCase())
        .filter(Boolean),
      windowStart: String(data.get('windowStart')),
      windowEnd: String(data.get('windowEnd')),
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
      <form
        className="settings-form"
        onSubmit={(event) => void submit(event)}
        key={JSON.stringify(settings)}
      >
        <section className="settings-section">
          <div>
            <h3>Download allowance</h3>
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
        <section className="settings-section">
          <div>
            <h3>Transfer preferences</h3>
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
            <label>
              Connection mode
              <select name="mode" defaultValue={settings.mode}>
                <option value="auto">Adaptive · recommended</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label>
              Maximum connections
              <select name="maxConnections" defaultValue={settings.maxConnections}>
                {[1, 2, 4, 8, 16].map((n) => (
                  <option key={n} value={n}>
                    {n} connection{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Global speed limit <span className="optional">KB/s · 0 = unlimited</span>
              <input
                name="globalLimit"
                type="number"
                min="0"
                defaultValue={settings.globalLimit / 1024}
              />
            </label>
          </div>
        </section>
        <section className="settings-section">
          <div>
            <h3>Scheduling & recovery</h3>
            <p>
              Scheduling runs while the manager is open. Leave both times empty for all-day
              downloads.
            </p>
          </div>
          <div className="form-grid">
            <label>
              Download window starts
              <input name="windowStart" type="time" defaultValue={settings.windowStart} />
            </label>
            <label>
              Download window ends
              <input name="windowEnd" type="time" defaultValue={settings.windowEnd} />
            </label>
            <label>
              After an interrupted session
              <select name="recovery" defaultValue={settings.recovery}>
                <option value="ask">Wait for me to resume</option>
                <option value="auto">Resume compatible downloads</option>
              </select>
            </label>
            <label>
              Automatic retry attempts (0 = off)
              <input
                name="retryAttempts"
                type="number"
                min={0}
                max={20}
                step={1}
                defaultValue={settings.retryAttempts}
              />
            </label>
            <label>
              Initial retry delay (seconds)
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
          <p className="small muted">
            Retry temporary network/server failures after the engine's request retries finish. The
            delay doubles up to 24 hours; a server's longer Retry-After is respected. Applies to
            existing transient failures and new Flux transfers. Manual pause stops automatic
            retries. Login, permission, missing-file, storage and verification errors need your
            attention. Named queues can override these defaults. Keep the manager open.
          </p>
        </section>
        <section className="settings-section">
          <div>
            <h3>Saving & categories</h3>
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
              {categoryNames.map((category) => (
                <label key={category}>
                  {category} folder
                  <input
                    name={`categoryFolder-${category}`}
                    defaultValue={settings.categoryFolders[category]}
                    placeholder={defaultSettings.categoryFolders[category]}
                  />
                </label>
              ))}
            </div>
            <p className="small muted">
              The Downloads folder is the one set in Chrome's settings
              (chrome://settings/downloads); change it there to move everything. To save somewhere
              else, use Choose download folder below. Files Chrome downloads itself always use the
              Downloads folder.
            </p>
          </div>
        </section>
        <section className="settings-section">
          <div>
            <h3>Browser integration</h3>
            <p>Eligible direct HTTP links only. Host access is requested when a URL needs it.</p>
          </div>
          <div className="form-stack">
            <label className="switch-row">
              <span>
                <strong>Completion sound</strong>
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
                <strong>Automatically capture downloads</strong>
                <small>
                  Eligible file links start in Flux. Enabling requests website access and also works
                  in already open tabs.
                </small>
              </span>
              <input name="interception" type="checkbox" defaultChecked={settings.interception} />
            </label>
            <label className="switch-row">
              <span>
                <strong>Completion notifications</strong>
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
        <section className="settings-section">
          <div>
            <h3>Appearance & history</h3>
            <p>Your workspace, your preference.</p>
          </div>
          <div className="form-stack">
            <div className="form-grid">
              <label>
                Theme
                <select name="theme" defaultValue={settings.theme}>
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
      <Companion />
      <MediaInspection />
      <section className="storage-settings panel">
        <div>
          <h3>Download folder</h3>
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
      <section className="storage-settings panel">
        <div>
          <h3>Website access</h3>
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
      <section className="storage-settings panel">
        <div>
          <h3>Local storage</h3>
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
