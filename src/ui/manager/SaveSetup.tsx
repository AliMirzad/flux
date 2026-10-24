import { useState } from 'react';
import { FolderDown, TriangleAlert, X } from 'lucide-react';
import type { ManagerAPI } from '../../application/contracts';
import type { Snapshot } from '../../domain/model';
import { folderSegments } from '../../shared/files';

/** Main-page status for automatic saving, next to the capture status. */
export function SaveSetup({
  snapshot,
  manager,
  run,
  onSettings,
}: {
  snapshot: Snapshot;
  manager: ManagerAPI;
  run: (fn: () => Promise<unknown>) => void;
  onSettings: () => void;
}) {
  const settings = snapshot.settings;
  const [hidden, setHidden] = useState(false);
  const inFolder = settings.saveLocation === 'folder' && !!snapshot.destination;
  const base = inFolder
    ? snapshot.destination!.name
    : ['Downloads', ...folderSegments(settings.downloadsSubfolder ?? '')].join('/');
  const target = settings.saveByCategory ? `${base}/<category>` : base;
  // The browser's own "ask where to save" dialog can only be turned off by the user.
  const blocked = settings.autoSave && !inFolder && settings.saveDialogDetected;
  if (!settings.autoSave)
    return (
      <section className="capture-setup" aria-label="Automatic saving">
        <FolderDown size={23} />
        <div>
          <strong>Automatic saving is off</strong>
          <p>Finished downloads wait until you press Save file.</p>
        </div>
        <button className="button primary" onClick={() => run(() => manager.setAutoSave(true))}>
          Turn on automatic saving
        </button>
      </section>
    );
  if (blocked)
    return (
      <section className="capture-setup warning" aria-label="Automatic saving">
        <TriangleAlert size={23} />
        <div>
          <strong>Your browser asks where to save each file</strong>
          <p>
            Turn off <b>Ask where to save each file before downloading</b> in the browser’s download
            settings, or let Flux write into a folder you choose. Then files save on their own.
          </p>
        </div>
        <div className="toolbar">
          <button
            className="button primary"
            onClick={() => run(() => chrome.tabs.create({ url: 'chrome://settings/downloads' }))}
          >
            Open download settings
          </button>
          <button
            className="button secondary"
            onClick={() => run(() => manager.chooseDownloadFolder())}
          >
            Choose a folder
          </button>
        </div>
      </section>
    );
  if (hidden) return null;
  return (
    <section className="capture-setup" aria-label="Automatic saving">
      <FolderDown size={23} />
      <div>
        <strong>Automatic saving is on</strong>
        <p>
          Finished downloads go to <code>{target}</code> automatically.
        </p>
        {!inFolder && (
          <details className="banner-details">
            <summary>About browser downloads</summary>
            <p>
              Files saved by Chrome also appear in its download list. Choose a folder to keep them
              out of that list. Chrome does not allow Downloads itself, so choose a subfolder such
              as <code>Downloads/Flux</code>.
            </p>
          </details>
        )}
      </div>
      <span className="banner-art folder-art" aria-hidden="true">
        <FolderDown size={34} strokeWidth={1.4} />
      </span>
      {inFolder ? (
        <button className="button secondary banner-action" onClick={onSettings}>
          <FolderDown size={16} /> Change folders
        </button>
      ) : (
        <button
          className="button secondary banner-action"
          onClick={() => run(() => manager.chooseDownloadFolder())}
        >
          <FolderDown size={16} /> Choose a folder
        </button>
      )}
      <button
        className="icon-button banner-close"
        aria-label="Dismiss banner"
        onClick={() => setHidden(true)}
      >
        <X size={18} />
      </button>
    </section>
  );
}
