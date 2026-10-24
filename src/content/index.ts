import { eligibleLink, excludedHost } from '../shared/capture';
import { PAGE_CHUNK_BYTES, PAGE_FILE_LIMIT } from '../application/page-transfer';
(() => {
  const scope = globalThis as typeof globalThis & {
    __fluxCaptureInstalled?: boolean | { dispose(): void };
  };
  if (typeof scope.__fluxCaptureInstalled === 'object') scope.__fluxCaptureInstalled.dispose();
  // An invalidated Chrome context can throw synchronously instead of returning a rejected Promise.
  // Keep that failure on the same fallback path as ordinary messaging rejection.
  const send = async (message: object) => chrome.runtime.sendMessage(message);
  const blobChunk = PAGE_CHUNK_BYTES;
  let disposed = false;
  let config: { enabled: boolean; excludedHosts: string[]; extensions: string[] } | null = null;
  const reload = async () => {
    try {
      const reply = await send({ type: 'offer-settings' });
      if (!disposed) config = reply;
    } catch {
      config = null;
    }
  };
  void reload();
  const messageListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
    _sender,
    respond,
  ) => {
    if (
      message?.type === 'fetch-blob' &&
      typeof message.url === 'string' &&
      message.url.startsWith(`blob:${location.origin}/`)
    ) {
      // Chrome already started this download (script-triggered); Flux takes the bytes instead.
      const blobPromise = fetch(message.url).then((response) => response.blob());
      blobPromise.catch(() => undefined);
      streamToFlux(
        blobPromise,
        typeof message.filename === 'string' ? message.filename : 'download',
      ).then(
        () => respond({ ok: true }),
        () => respond({ ok: false }),
      );
      return true;
    }
    if (message?.type === 'capture-config-changed') {
      void reload().then(() => respond({ ok: true }));
      return true;
    }
  };
  chrome.runtime.onMessage.addListener(messageListener);
  /** Hands the page's own bytes to the Flux manager in chunks; throws if Flux cannot take them. */
  const streamToFlux = async (blobPromise: Promise<Blob>, filename: string) => {
    const blob = await blobPromise;
    if (blob.size > PAGE_FILE_LIMIT)
      throw new Error('Use Chrome for page files larger than 1 GiB.');
    const reply = await send({ type: 'begin-blob', size: blob.size });
    const token = reply?.token;
    if (typeof token !== 'string') throw new Error('Flux cannot take this download.');
    try {
      for (let offset = 0, index = 0; offset < blob.size; offset += blobChunk, index++) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + blobChunk).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const ack = await send({ type: 'blob-chunk', token, index, data: btoa(binary) });
        if (!ack?.ok) throw new Error(ack?.error ?? 'Flux rejected the data.');
      }
      const done = await send({
        type: 'blob-done',
        token,
        size: blob.size,
        mime: blob.type,
        filename,
      });
      if (!done?.ok) throw new Error(done?.error ?? 'Flux could not save the data.');
    } catch (error) {
      await send({ type: 'blob-abort', token }).catch(() => undefined);
      throw error;
    }
  };
  const click = (event: MouseEvent) => {
    if (!globalThis.chrome?.runtime?.id) {
      config = null;
      return;
    }
    if (
      !config?.enabled ||
      !event.isTrusted ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.shiftKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (excludedHost(location.hostname, config.excludedHosts)) return;
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement) as
      HTMLAnchorElement | undefined;
    if (anchor && anchor.hasAttribute('download') && ['blob:', 'data:'].includes(anchor.protocol)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const original = anchor.cloneNode(false) as HTMLAnchorElement;
      const start = (prefix = '') => {
        original.download = prefix + (anchor.getAttribute('download') || 'download');
        original.style.display = 'none';
        document.documentElement.append(original);
        original.click();
        original.remove();
      };
      const kind = anchor.protocol.slice(0, -1);
      // Read the bytes now: pages often revoke the blob URL right after the click.
      const blobPromise = fetch(anchor.href).then((response) => response.blob());
      blobPromise.catch(() => undefined);
      const viaChrome = () =>
        void send({ type: 'prepare-browser-link', kind }).then(
          (reply) =>
            start(
              typeof reply?.prefix === 'string' && /^flux-[a-f\d-]{36}--$/.test(reply.prefix)
                ? reply.prefix
                : '',
            ),
          () => start(),
        );
      void streamToFlux(blobPromise, anchor.getAttribute('download') || 'download').catch(
        viaChrome,
      );
      return;
    }
    if (
      !anchor ||
      !eligibleLink(
        anchor.href,
        { excludedHosts: config.excludedHosts, fileExtensions: config.extensions },
        anchor.hasAttribute('download'),
      )
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const original = anchor.cloneNode(false) as HTMLAnchorElement;
    const useBrowser = () => {
      original.style.display = 'none';
      document.documentElement.append(original);
      original.click();
      original.remove();
    };
    void send({
      type: 'capture-link',
      url: anchor.href,
      explicitDownload: anchor.hasAttribute('download'),
      filename: anchor.getAttribute('download') || undefined,
    })
      .then((reply) => {
        if (!reply?.ok) useBrowser();
      })
      .catch(useBrowser);
  };
  document.addEventListener('click', click, true);
  scope.__fluxCaptureInstalled = {
    dispose() {
      disposed = true;
      config = null;
      document.removeEventListener('click', click, true);
      try {
        chrome.runtime.onMessage.removeListener(messageListener);
      } catch {
        /* The previous extension context may already be invalid. */
      }
    },
  };
})();
