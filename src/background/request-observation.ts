/** Register network observers only after optional website access exists. */
export function requestObservation(
  permissions: Pick<typeof chrome.permissions, 'getAll'>,
  webRequest: Pick<typeof chrome.webRequest, 'onBeforeRequest' | 'onHeadersReceived'>,
  beforeRequest: Parameters<typeof chrome.webRequest.onBeforeRequest.addListener>[0],
  headersReceived: Parameters<typeof chrome.webRequest.onHeadersReceived.addListener>[0],
) {
  let active: string[] = [];
  let pending = Promise.resolve();
  return function reconcile() {
    const task = pending
      .catch(() => undefined)
      .then(async () => {
        const granted = await permissions.getAll();
        const origins = [
          ...new Set(
            (granted.origins ?? []).flatMap((origin) =>
              origin === '<all_urls>'
                ? ['http://*/*', 'https://*/*']
                : /^https?:\/\//.test(origin)
                  ? [origin]
                  : [],
            ),
          ),
        ].sort();
        if (JSON.stringify(active) === JSON.stringify(origins)) return;
        webRequest.onBeforeRequest.removeListener(beforeRequest);
        webRequest.onHeadersReceived.removeListener(headersReceived);
        active = [];
        if (!origins.length) return;
        try {
          webRequest.onBeforeRequest.addListener(beforeRequest, { urls: origins });
          webRequest.onHeadersReceived.addListener(headersReceived, { urls: origins }, [
            'responseHeaders',
          ]);
          active = origins;
        } catch (error) {
          webRequest.onBeforeRequest.removeListener(beforeRequest);
          webRequest.onHeadersReceived.removeListener(headersReceived);
          throw error;
        }
      });
    pending = task;
    return task;
  };
}
