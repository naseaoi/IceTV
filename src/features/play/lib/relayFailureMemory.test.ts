import { getVideoResolutionFromM3u8 } from '@/features/play/lib/hls-utils';
import {
  isSourceServerUnavailable,
  rememberRelayFailure,
} from '@/features/play/lib/relayFailureMemory';
import {
  getSourcePlaybackRoute,
  rememberSourceServerProxy,
} from '@/lib/proxy-modes';
import { reportSourceRouteStat } from '@/lib/source-route-stats.client';

jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourceRouteStat: jest.fn(),
  reportSourcePlayOutcome: jest.fn(),
}));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it('自动模式忽略代理成功记忆且失败时不再回落服务器，固定代理测速直接跳过', async () => {
  const url = 'https://blocked-route.example/a.m3u8';
  const source = 'blocked-route';
  rememberSourceServerProxy(source, url);
  expect(
    getSourcePlaybackRoute(source, url, { [source]: 'auto' }).useServerProxy,
  ).toBe(true);
  rememberRelayFailure(source, url, (name) =>
    name === 'Retry-After' ? '600' : 'host-connection',
  );
  expect(
    getSourcePlaybackRoute(source, url, { [source]: 'auto' }).useServerProxy,
  ).toBe(false);
  expect(
    getSourcePlaybackRoute(source, url, { [source]: 'server' }).useServerProxy,
  ).toBe(true);
  global.fetch = jest.fn().mockRejectedValue(new TypeError('network'));
  await expect(
    getVideoResolutionFromM3u8(
      url,
      { useServerProxy: true, directManifest: false, allowAutoFallback: true },
      source,
    ),
  ).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(url);
  expect(reportSourceRouteStat).not.toHaveBeenCalledWith(
    source,
    'server',
    false,
    expect.anything(),
  );
  await expect(
    getVideoResolutionFromM3u8(
      url,
      { useServerProxy: true, directManifest: false, allowAutoFallback: false },
      source,
    ),
  ).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    getVideoResolutionFromM3u8(
      url,
      { useServerProxy: true, directManifest: false, allowAutoFallback: false },
      source,
      cancelled.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

it('按源和主机端口隔离，冷却到期后恢复尝试', () => {
  const url = 'https://ttl-route.example/a.m3u8';
  rememberRelayFailure('ttl', url, (name) =>
    name === 'Retry-After' ? '10' : 'host-forbidden',
  );
  expect(isSourceServerUnavailable('ttl', url)).toBe(true);
  expect(isSourceServerUnavailable('other', url)).toBe(false);
  expect(
    isSourceServerUnavailable('ttl', 'https://ttl-route.example:8443/a.m3u8'),
  ).toBe(false);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_001);
  expect(isSourceServerUnavailable('ttl', url)).toBe(false);
});
