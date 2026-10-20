import { eligibleLink, excludedHost } from '../shared/capture';
(() => {
  const scope = globalThis as typeof globalThis & { __fluxCaptureInstalled?: boolean };
  if (scope.__fluxCaptureInstalled) return;
  scope.__fluxCaptureInstalled = true;
  let config: { enabled: boolean; excludedHosts: string[]; extensions: string[] } | null = null;
  const reload = async () => {
    try {
      config = await chrome.runtime.sendMessage({ type: 'offer-settings' });
    } catch {
      config = null;
    }
  };
  void reload();
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'capture-config-changed') {
      void reload().then(() => respond({ ok: true }));
      return true;
    }
  });
  document.addEventListener(
    'click',
    (event) => {
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
      if (
        anchor &&
        anchor.hasAttribute('download') &&
        ['blob:', 'data:'].includes(anchor.protocol)
      ) {
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
        void chrome.runtime
          .sendMessage({ type: 'prepare-browser-link', kind: anchor.protocol.slice(0, -1) })
          .then(
            (reply) =>
              start(
                typeof reply?.prefix === 'string' && /^flux-[a-f\d-]{36}--$/.test(reply.prefix)
                  ? reply.prefix
                  : '',
              ),
            () => start(),
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
      void chrome.runtime
        .sendMessage({
          type: 'capture-link',
          url: anchor.href,
          explicitDownload: anchor.hasAttribute('download'),
          filename: anchor.getAttribute('download') || undefined,
        })
        .then((reply) => {
          if (!reply?.ok) useBrowser();
        })
        .catch(useBrowser);
    },
    true,
  );
})();
