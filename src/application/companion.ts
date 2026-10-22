export const companionHost = 'com.flux.media_companion';
export const companionReloadMessage =
  'Chrome needs Flux to reload after approving companion access. Finish or pause active downloads, reload Flux, then reopen Settings and try again.';
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

export interface CompanionDestination {
  id: string;
  label: string;
}

export function parseDestinations(value: unknown): CompanionDestination[] {
  if (!Array.isArray(value) || value.length > 50)
    throw new Error('The companion returned invalid save folders.');
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!record(item) || !shortString(item.id) || !shortString(item.label) || ids.has(item.id))
      throw new Error('The companion returned invalid save folders.');
    ids.add(item.id);
    return { id: item.id, label: item.label };
  });
}

export function listCompanionDestinations(
  runtime: Parameters<typeof probeCompanion>[0],
  signal: AbortSignal,
): Promise<CompanionDestination[]> {
  if (signal.aborted)
    return Promise.reject(new DOMException('Folder check canceled.', 'AbortError'));
  if (typeof runtime.connectNative !== 'function')
    return Promise.reject(new Error(companionReloadMessage));
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = runtime.connectNative(companionHost);
    } catch {
      reject(new Error('Install the companion, then refresh save folders.'));
      return;
    }
    let stage: 'hello' | 'list' = 'hello';
    let id = crypto.randomUUID();
    let finished = false;
    const finish = (error?: Error, result?: CompanionDestination[]) => {
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
    const abort = () => finish(new DOMException('Folder check canceled.', 'AbortError'));
    const disconnected = () => {
      void runtime.lastError;
      finish(new Error('Could not connect. Install the companion and check its connection first.'));
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
          throw new Error('The companion returned an invalid folder response.');
        if ('error' in value)
          throw new Error(
            'Could not read approved folders. Check the local companion configuration.',
          );
        if (stage === 'hello') {
          if (!parseDiagnostics(value.result).capabilities.includes('destinations.list'))
            throw new Error('Reinstall the companion to enable approved save folders.');
          stage = 'list';
          id = crypto.randomUUID();
          port.postMessage({
            protocol: 1,
            kind: 'request',
            id,
            method: 'destinations.list',
            params: {},
          });
        } else finish(undefined, parseDestinations(value.result));
      } catch (cause) {
        finish(cause instanceof Error ? cause : new Error('Invalid folder response.'));
      }
    };
    const timer = setTimeout(
      () => finish(new Error('Save folder check timed out. Try again.')),
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
      finish(new Error('Could not request approved save folders.'));
    }
  });
}

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
  if (typeof runtime.connectNative !== 'function')
    return Promise.reject(new Error(companionReloadMessage));
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

export interface CompanionReview {
  reviewId: string;
  expiresAt: number;
  title: string;
  duration: number | null;
  truncated: boolean;
  formats: {
    selectionId: string;
    label: string;
    container: string | null;
    height: number | null;
    hasVideo: boolean | null;
    hasAudio: boolean | null;
  }[];
}

export function parseReview(value: unknown): CompanionReview {
  const text = (item: unknown, limit: number): item is string =>
    typeof item === 'string' && item.length > 0 && item.length <= limit;
  const positive = (item: unknown): item is number =>
    typeof item === 'number' && Number.isFinite(item) && item >= 0;
  if (
    !record(value) ||
    !shortString(value.reviewId) ||
    !positive(value.expiresAt) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt > Date.now() + 630000 ||
    !text(value.title, 512) ||
    (value.duration !== null && !positive(value.duration)) ||
    typeof value.truncated !== 'boolean' ||
    !Array.isArray(value.formats) ||
    value.formats.length < 1 ||
    value.formats.length > 200
  )
    throw new Error('The companion returned an invalid media review.');
  const ids = new Set<string>();
  const formats = value.formats.map((item: unknown) => {
    if (
      !record(item) ||
      !shortString(item.selectionId) ||
      ids.has(item.selectionId) ||
      !text(item.label, 512) ||
      (item.container !== null && !text(item.container, 32)) ||
      (item.height !== null &&
        (!positive(item.height) || !Number.isInteger(item.height) || item.height === 0)) ||
      (item.hasVideo !== null && typeof item.hasVideo !== 'boolean') ||
      (item.hasAudio !== null && typeof item.hasAudio !== 'boolean') ||
      (item.hasVideo === false && item.hasAudio === false)
    )
      throw new Error('The companion returned invalid media selections.');
    ids.add(item.selectionId);
    return {
      selectionId: item.selectionId,
      label: item.label,
      container: item.container as string | null,
      height: item.height as number | null,
      hasVideo: item.hasVideo as boolean | null,
      hasAudio: item.hasAudio as boolean | null,
    };
  });
  return {
    reviewId: value.reviewId,
    expiresAt: value.expiresAt,
    title: value.title,
    duration: value.duration as number | null,
    truncated: value.truncated,
    formats,
  };
}

const inspectionErrors: Record<string, string> = {
  DEPENDENCY_MISSING:
    'Install yt-dlp 2026.03.17 in the companion’s Python runtime, then reinstall the companion.',
  INVALID_URL: 'Enter a public HTTP(S) media URL without credentials.',
  BUSY: 'Another inspection is still running. Try again shortly.',
  CANCELED: 'Media inspection canceled.',
  EXTRACTION_FAILED:
    'Could not inspect this media. This preview does not support every website or extraction method.',
  UNSUPPORTED_CAPABILITY: 'Install a companion version that supports media inspection.',
};

// The caller owns the port through this signal, including after review resolves.
// Keeping it open retains the private native review; abort clears that ownership.
export function inspectCompanion(
  runtime: Parameters<typeof probeCompanion>[0],
  url: string,
  signal: AbortSignal,
  disconnectedAfterReview: () => void = () => {},
): Promise<CompanionReview> {
  if (signal.aborted) return Promise.reject(new DOMException('Inspection canceled.', 'AbortError'));
  if (typeof runtime.connectNative !== 'function')
    return Promise.reject(new Error(companionReloadMessage));
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = runtime.connectNative(companionHost);
    } catch {
      reject(new Error('Could not connect. Install the companion for this extension ID.'));
      return;
    }
    const helloId = crypto.randomUUID();
    const inspectId = crypto.randomUUID();
    let stage: 'hello' | 'inspect' | 'review' | 'closed' = 'hello';
    let timer: ReturnType<typeof setTimeout>;
    const close = (error?: Error) => {
      if (stage === 'closed') return;
      const resolved = stage === 'review';
      stage = 'closed';
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      port.onMessage.removeListener(message);
      port.onDisconnect.removeListener(disconnected);
      port.disconnect();
      if (!resolved) reject(error ?? new DOMException('Inspection canceled.', 'AbortError'));
      else if (error) disconnectedAfterReview();
    };
    const abort = () => close();
    const disconnected = () => {
      void runtime.lastError;
      close(new Error('The companion disconnected. Check its installation and try again.'));
    };
    const deadline = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => close(new Error('Media inspection timed out. Try again.')), ms);
    };
    const message = (value: unknown) => {
      try {
        if (
          new TextEncoder().encode(JSON.stringify(value)).length > maxFrame ||
          !record(value) ||
          value.protocol !== 1 ||
          value.kind !== 'response' ||
          value.id !== (stage === 'hello' ? helloId : inspectId) ||
          'result' in value === 'error' in value
        )
          throw new Error('The companion returned an invalid response.');
        if ('error' in value) {
          const code =
            record(value.error) && typeof value.error.code === 'string' ? value.error.code : '';
          throw new Error(
            inspectionErrors[code] ?? 'The companion could not complete media inspection.',
          );
        }
        if (stage === 'hello') {
          const info = parseDiagnostics(value.result);
          if (!info.capabilities.includes('inspect'))
            throw new Error(inspectionErrors.UNSUPPORTED_CAPABILITY);
          stage = 'inspect';
          deadline(90000);
          port.postMessage({
            protocol: 1,
            kind: 'request',
            id: inspectId,
            method: 'inspect',
            params: { url },
          });
        } else if (stage === 'inspect') {
          const review = parseReview(value.result);
          if (review.expiresAt <= Date.now())
            throw new Error('This media review expired. Inspect again.');
          stage = 'review';
          clearTimeout(timer);
          resolve(review);
        } else throw new Error('Unexpected companion response.');
      } catch (error) {
        close(error instanceof Error ? error : new Error('Invalid companion response.'));
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    port.onMessage.addListener(message);
    port.onDisconnect.addListener(disconnected);
    deadline(10000);
    try {
      port.postMessage({
        protocol: 1,
        kind: 'request',
        id: helloId,
        method: 'hello',
        params: { extensionVersion: runtime.getManifest().version },
      });
    } catch {
      close(new Error('Could not contact the companion.'));
    }
  });
}
