import { expect, it } from 'vitest';
import { request } from '../../src/engine/network/http';
it('omits ambient credentials by default, even when a caller supplies include', async () => {
  let mode: RequestCredentials | undefined;
  await request('https://source.example/file', { credentials: 'include' }, (async (_url, init) => {
    mode = init?.credentials;
    return new Response('file');
  }) as typeof fetch);
  expect(mode).toBe('omit');
});
it('uses an explicitly authorized source session, omits cookies on CDN hops and unrelated HLS children', async () => {
  const calls: [string, RequestCredentials | undefined][] = [];
  const fetcher = (async (url, init) => {
    calls.push([String(url), init?.credentials]);
    return String(url).endsWith('/start')
      ? new Response(null, { status: 302, headers: { Location: 'https://cdn.example/file' } })
      : new Response('file');
  }) as typeof fetch;
  const policy = {
    credentialOrigin: 'https://source.example',
    resolveRedirect: async (_from: string, location: string | null) => location!,
  };
  await request('https://source.example/start', {}, fetcher, false, policy);
  await request('https://source.example/part', {}, fetcher, false, policy);
  await request('https://keys.example/key', {}, fetcher, false, policy);
  expect(calls).toEqual([
    ['https://source.example/start', 'include'],
    ['https://cdn.example/file', 'omit'],
    ['https://source.example/part', 'include'],
    ['https://keys.example/key', 'omit'],
  ]);
});
