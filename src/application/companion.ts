export const companionHost = 'com.flux.media_companion';
const maxFrame = 256 * 1024;

export interface CompanionDiagnostics {
  companionVersion: string;
  protocol: 1;
  platform: string;
  capabilities: string[];
  dependencies: Record<
    'ytDlp' | 'ffmpeg' | 'ffprobe',
    {
      available: boolean;
      status: 'available' | 'missing' | 'probe-failed';
      version?: string;
    }
  >;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const shortString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;

export function parseDiagnostics(value: unknown): CompanionDiagnostics {
  if (!record(value) || value.protocol !== 1)
    throw new Error('Install compatible Flux and companion versions.');
  if (
    !shortString(value.companionVersion) ||
    !shortString(value.platform) ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > 32 ||
    !value.capabilities.every(shortString) ||
    !value.capabilities.includes('diagnostics') ||
    !record(value.dependencies)
  )
    throw new Error('The companion returned invalid diagnostics.');
  for (const name of ['ytDlp', 'ffmpeg', 'ffprobe']) {
    const item = value.dependencies[name];
    if (
      !record(item) ||
      typeof item.available !== 'boolean' ||
      !['available', 'missing', 'probe-failed'].includes(String(item.status)) ||
      item.available !== (item.status === 'available') ||
      (item.available && !shortString(item.version)) ||
      (item.version !== undefined && !shortString(item.version))
    )
      throw new Error('The companion returned invalid dependency information.');
  }
  return value as unknown as CompanionDiagnostics;
}

// Diagnostics use a short-lived port. Future job execution will retain its port
// for the manager owner's lifetime; this probe never starts background work.
export function probeCompanion(
  runtime: Pick<typeof chrome.runtime, 'connectNative' | 'getManifest' | 'lastError'>,
  signal: AbortSignal,
): Promise<CompanionDiagnostics> {
  if (signal.aborted)
    return Promise.reject(new DOMException('Connection check canceled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = runtime.connectNative(companionHost);
    } catch {
      reject(new Error('Could not connect. Install the macOS companion for this extension ID.'));
      return;
    }
    const id = crypto.randomUUID();
    let finished = false;
    const finish = (error?: Error, result?: CompanionDiagnostics) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      port.onMessage.removeListener(message);
      port.onDisconnect.removeListener(disconnected);
      port.disconnect();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException('Connection check canceled.', 'AbortError'));
    const disconnected = () => {
      // Read lastError while the event is active, but do not expose raw native errors.
      const hadError = Boolean(runtime.lastError);
      finish(
        new Error(
          hadError
            ? 'Connection failed. Install the companion for this extension ID, then check its registration and Python runtime.'
            : 'The companion closed before completing its connection check.',
        ),
      );
    };
    const message = (value: unknown) => {
      try {
        if (
          new TextEncoder().encode(JSON.stringify(value)).length > maxFrame ||
          !record(value) ||
          value.protocol !== 1 ||
          value.kind !== 'response' ||
          value.id !== id ||
          'result' in value === 'error' in value
        )
          throw new Error('The companion returned an invalid or incompatible response.');
        if ('error' in value)
          throw new Error(
            'The companion rejected the connection check. Install compatible versions.',
          );
        finish(undefined, parseDiagnostics(value.result));
      } catch (cause) {
        finish(cause instanceof Error ? cause : new Error('Invalid companion response.'));
      }
    };
    const timer = setTimeout(
      () =>
        finish(new Error('Companion connection timed out. Check its installation and try again.')),
      10000,
    );
    signal.addEventListener('abort', abort, { once: true });
    port.onMessage.addListener(message);
    port.onDisconnect.addListener(disconnected);
    try {
      port.postMessage({
        protocol: 1,
        kind: 'request',
        id,
        method: 'hello',
        params: { extensionVersion: runtime.getManifest().version },
      });
    } catch {
      finish(new Error('Could not send the companion connection check.'));
    }
  });
}
