import { expect, it, vi } from 'vitest';
import { requestObservation } from '../../src/background/request-observation';

function setup(origins: string[] = []) {
  const permissions = { getAll: vi.fn(async () => ({ origins })) };
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  const webRequest = { onBeforeRequest: event(), onHeadersReceived: event() };
  const reconcile = requestObservation(
    permissions as unknown as Pick<typeof chrome.permissions, 'getAll'>,
    webRequest as unknown as Pick<
      typeof chrome.webRequest,
      'onBeforeRequest' | 'onHeadersReceived'
    >,
    vi.fn(),
    vi.fn(),
  );
  return { permissions, webRequest, reconcile };
}
it('does not register observers on a fresh install without website access', async () => {
  const { reconcile, webRequest } = setup();
  await reconcile();
  expect(webRequest.onBeforeRequest.addListener).not.toHaveBeenCalled();
  expect(webRequest.onHeadersReceived.addListener).not.toHaveBeenCalled();
});
it('uses only granted HTTP origins and does not re-register unchanged permissions', async () => {
  const { reconcile, webRequest } = setup(['https://example.com/*', 'file:///*']);
  await reconcile();
  await reconcile();
  expect(webRequest.onBeforeRequest.addListener).toHaveBeenCalledExactlyOnceWith(
    expect.any(Function),
    { urls: ['https://example.com/*'] },
  );
  expect(webRequest.onHeadersReceived.addListener).toHaveBeenCalledExactlyOnceWith(
    expect.any(Function),
    { urls: ['https://example.com/*'] },
    ['responseHeaders'],
  );
});
it('registers after a grant and removes both observers after revocation', async () => {
  const { reconcile, permissions, webRequest } = setup();
  await reconcile();
  permissions.getAll.mockResolvedValue({ origins: ['https://example.com/*'] });
  await reconcile();
  permissions.getAll.mockResolvedValue({ origins: [] });
  await reconcile();
  expect(webRequest.onBeforeRequest.addListener).toHaveBeenCalledTimes(1);
  expect(webRequest.onBeforeRequest.removeListener).toHaveBeenCalledTimes(2);
  expect(webRequest.onHeadersReceived.removeListener).toHaveBeenCalledTimes(2);
});
it('narrows filters when one of several site grants is removed', async () => {
  const { reconcile, permissions, webRequest } = setup([
    'https://a.example/*',
    'https://b.example/*',
  ]);
  await reconcile();
  permissions.getAll.mockResolvedValue({ origins: ['https://b.example/*'] });
  await reconcile();
  expect(webRequest.onBeforeRequest.addListener).toHaveBeenLastCalledWith(expect.any(Function), {
    urls: ['https://b.example/*'],
  });
});
it('limits an all-URL grant to HTTP and HTTPS observation', async () => {
  const { reconcile, webRequest } = setup(['<all_urls>']);
  await reconcile();
  expect(webRequest.onBeforeRequest.addListener).toHaveBeenCalledWith(expect.any(Function), {
    urls: ['http://*/*', 'https://*/*'],
  });
});
it('awaits startup permission discovery before reporting readiness', async () => {
  const { reconcile, permissions, webRequest } = setup();
  let release!: (value: { origins: string[] }) => void;
  permissions.getAll.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  let ready = false;
  const pending = reconcile().then(() => {
    ready = true;
  });
  await vi.waitFor(() => expect(permissions.getAll).toHaveBeenCalled());
  expect(ready).toBe(false);
  release({ origins: ['https://example.com/*'] });
  await pending;
  expect(webRequest.onHeadersReceived.addListener).toHaveBeenCalledTimes(1);
});
it('cleans up partial registration and retries after an API failure', async () => {
  const { reconcile, webRequest } = setup(['https://example.com/*']);
  webRequest.onHeadersReceived.addListener.mockImplementationOnce(() => {
    throw new Error('failed');
  });
  await expect(reconcile()).rejects.toThrow('failed');
  expect(webRequest.onBeforeRequest.removeListener).toHaveBeenCalledTimes(2);
  await reconcile();
  expect(webRequest.onHeadersReceived.addListener).toHaveBeenCalledTimes(2);
});
