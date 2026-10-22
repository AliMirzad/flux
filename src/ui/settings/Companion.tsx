import { useEffect, useRef, useState } from 'react';
import { probeCompanion, type CompanionDiagnostics } from '../../application/companion';

export function Companion() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CompanionDiagnostics | null>(null);
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
        'flux-companion-diagnostics',
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
    <section className="storage-settings panel">
      <div>
        <h3>Media companion</h3>
        <p>
          Optional macOS development preview. Check the connection and installed media tools. Media
          downloads will be added in a later milestone.
        </p>
        <p className="small muted">
          <a
            href="https://github.com/k4vrin/flux/blob/feature/media-companion/companion/README.md"
            target="_blank"
            rel="noreferrer"
          >
            Development installation instructions
          </a>
          . Your extension ID: <code>{globalThis.chrome?.runtime?.id ?? 'not installed'}</code>
        </p>
      </div>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void check()}
      >
        {busy ? 'Checking companion…' : 'Check companion connection'}
      </button>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {result && (
        <div role="status">
          <p>
            Connected to companion {result.companionVersion} on {result.platform}. Diagnostics only.
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
        </div>
      )}
    </section>
  );
}
