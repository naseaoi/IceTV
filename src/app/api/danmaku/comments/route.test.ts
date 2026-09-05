import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { DanmakuProviderError } from '@/features/play/lib/danmaku/types';

installWebPolyfills();

const mockFetchDanmaku = jest.fn();
const mockRecordFailure = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn().mockResolvedValue({ username: 'test-user' }),
  isGuardFailure: () => false,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest
    .fn()
    .mockResolvedValue({ SiteConfig: { EnableDanmaku: true } }),
}));
jest.mock('@/lib/runtime-params', () => ({
  normalizeRuntimeParams: () => ({ DanmakuEpisodeLimit: 1000 }),
}));
jest.mock('@/app/api/danmaku/cache', () => ({
  danmakuCommentsCache: {
    invalidate: (...args: unknown[]) => mockInvalidate(...args),
    getOrLoad: (_key: string, load: () => Promise<unknown>) => load(),
  },
}));
jest.mock('@/features/play/lib/danmaku/provider.server', () => ({
  fetchDanmakuByEpisodeId: (...args: unknown[]) => mockFetchDanmaku(...args),
  isDanmakuProviderConfigured: () => true,
}));
jest.mock('@/lib/server-proxy-guard', () => ({
  requireServerProxyQuota: () => null,
  recordServerProxyFailure: (...args: unknown[]) => mockRecordFailure(...args),
}));

const { GET } = require('./route') as typeof import('./route');

function createRequest(episodeId = '13143', refresh?: string): NextRequest {
  const refreshQuery = refresh ? `&refresh=${refresh}` : '';
  return {
    nextUrl: new URL(
      `http://localhost/api/danmaku/comments?episodeId=${episodeId}${refreshQuery}`,
    ),
  } as NextRequest;
}

describe('danmaku comment errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates only the requested cache entry on explicit refresh', async () => {
    mockFetchDanmaku.mockResolvedValue({ items: [] });
    const response = await GET(createRequest('13143', '1'));
    expect(response.status).toBe(200);
    expect(mockInvalidate).toHaveBeenCalledWith('13143:1000');
    expect(mockFetchDanmaku).toHaveBeenCalledWith(13143, 1000);
  });

  it('returns an explicit recoverable 404 for expired episode IDs', async () => {
    mockFetchDanmaku.mockRejectedValue(
      new DanmakuProviderError('episode-not-found', 'upstream 404'),
    );
    const response = await GET(createRequest());
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: '弹幕集数映射已失效',
      code: 'DANMAKU_EPISODE_NOT_FOUND',
    });
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it('keeps network failures generic and does not leak upstream details', async () => {
    const error = new DanmakuProviderError(
      'upstream-unavailable',
      'private upstream details',
    );
    mockFetchDanmaku.mockRejectedValue(error);
    const logging = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(createRequest());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: '弹幕拉取失败' });
    expect(mockRecordFailure).toHaveBeenCalledWith('danmaku', error);
    logging.mockRestore();
  });

  it('rejects invalid episode identifiers before loading comments', async () => {
    const response = await GET(createRequest('-1'));
    expect(response.status).toBe(400);
    expect(mockFetchDanmaku).not.toHaveBeenCalled();
  });
});
