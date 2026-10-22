import { CompanionError } from './CompanionError';
import { useEffect, useRef, useState } from 'react';
import { probeCompanion, type CompanionDiagnostics } from '../../application/companion';

export function Companion() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CompanionDiagnostics | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const extensionId = globalThis.chrome?.runtime?.id;
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function check() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      if (!globalThis.chrome?.runtime?.id)
        throw new Error('Open Settings in the installed Flux extension to check the companion.');
      const granted = await chrome.permissions.request({ permissions: ['nativeMessaging'] });
      if (!granted)
        throw new Error('Companion access was declined. You can check again when ready.');
      if (controller.signal.aborted) return;
      await navigator.locks.request(
        'flux-companion-session',
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error('Another Flux tab is checking the companion. Try again shortly.');
          const value = await probeCompanion(chrome.runtime, controller.signal);
          if (!controller.signal.aborted) setResult(value);
        },
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Connection check failed.');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="storage-settings panel companion-setup" aria-label="Media companion setup">
      <div>
        <h3>Media companion</h3>
        <p>
          Install the optional companion to inspect media and prepare save folders. Ordinary Flux
          downloads work without it. This macOS preview does not save media yet.
        </p>
      </div>
      <ol className="companion-steps">
        <li>
          <strong>Copy your extension ID</strong>
          <div className="companion-id">
            <code>{extensionId ?? 'Open the installed Flux extension first'}</code>
            <button
              type="button"
              className="button secondary"
              disabled={!extensionId}
              onClick={() => {
                void navigator.clipboard.writeText(extensionId!).then(
                  () => setCopyStatus('Extension ID copied.'),
                  () => setCopyStatus('Could not copy. Select and copy the ID shown above.'),
                );
              }}
            >
              Copy extension ID
            </button>
          </div>
          {copyStatus && <p role="status">{copyStatus}</p>}
        </li>
        <li>
          <strong>Install on your Mac</strong>
          <p>
            Download and unzip the installer, then open <code>Install.command</code>. Paste your
            extension ID when asked. Requires an installed Python 3.10+ and internet access to
            download yt-dlp. The installer asks before replacing an existing companion.
          </p>
          <a
            className="button secondary"
            href="companion/flux-media-companion-macos.zip"
            download="flux-media-companion-macos.zip"
          >
            Download macOS installer
          </a>
          <p className="small muted">
            Chrome cannot run the installer for you. This development installer is unsigned; if
            macOS prevents it from opening, review the file and use System Settings → Privacy &amp;
            Security to allow it. Windows setup is not available yet.
          </p>
        </li>
        <li>
          <strong>Check the connection</strong>
          <p>
            Return here after setup and grant companion access when Chrome asks. Keep this extension
            folder in place so its ID stays the same.
          </p>
        </li>
      </ol>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void check()}
      >
        {busy ? 'Checking companion…' : 'Check companion connection'}
      </button>
      {error && <CompanionError message={error} />}
      {result && (
        <div role="status">
          <p>
            Connected to companion {result.companionVersion} on {result.platform}.{' '}
            {result.capabilities.includes('inspect')
              ? 'Media inspection available.'
              : 'Diagnostics only.'}
          </p>
          <ul>
            {Object.entries(result.dependencies).map(([name, item]) => (
              <li key={name}>
                {name === 'ytDlp' ? 'yt-dlp' : name}:{' '}
                {item.available
                  ? item.version
                  : item.status === 'missing'
                    ? 'not installed'
                    : 'version check failed'}
              </li>
            ))}
          </ul>
          <p className="small muted">
            Inspection uses yt-dlp installed in the companion's Python runtime. FFmpeg and ffprobe
            are required for the upcoming download and conversion flow.
          </p>
        </div>
      )}
    </section>
  );
}
