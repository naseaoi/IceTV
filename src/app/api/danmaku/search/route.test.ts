import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockInvalidate = jest.fn();
const mockGetOrLoad = jest.fn().mockResolvedValue([]);
const mockQuota = jest.fn().mockReturnValue(null);

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn().mockResolvedValue({ username: 'test-user' }),
  isGuardFailure: () => false,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest
    .fn()
    .mockResolvedValue({ SiteConfig: { EnableDanmaku: true } }),
}));
jest.mock('@/app/api/danmaku/cache', () => ({
  danmakuSearchCache: {
    getOrLoad: (...args: unknown[]) => mockGetOrLoad(...args),
    invalidate: (...args: unknown[]) => mockInvalidate(...args),
  },
}));
jest.mock('@/features/play/lib/danmaku/provider.server', () => ({
  searchDanmakuCandidates: jest.fn(),
  isDanmakuProviderConfigured: () => true,
}));
jest.mock('@/lib/server-proxy-guard', () => ({
  requireServerProxyQuota: (...args: unknown[]) => mockQuota(...args),
  recordServerProxyFailure: jest.fn(),
}));

const { GET } = require('./route') as typeof import('./route');

function createRequest(refresh?: string): NextRequest {
  const nextUrl = new URL('http://localhost/api/danmaku/search?keyword=test');
  if (refresh) nextUrl.searchParams.set('refresh', refresh);
  return { nextUrl } as NextRequest;
}

describe('danmaku search refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuota.mockReturnValue(null);
  });

  it('preserves the cache during normal searches', async () => {
    expect((await GET(createRequest())).status).toBe(200);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('invalidates only the requested keyword on explicit recovery', async () => {
    expect((await GET(createRequest('1'))).status).toBe(200);
    expect(mockInvalidate).toHaveBeenCalledWith('test');
    expect(mockGetOrLoad).toHaveBeenCalledWith('test', expect.any(Function));
    expect(mockInvalidate.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetOrLoad.mock.invocationCallOrder[0],
    );
  });

  it('keeps refresh requests subject to the existing quota', async () => {
    mockQuota.mockReturnValue(new Response('', { status: 429 }));
    expect((await GET(createRequest('1'))).status).toBe(429);
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(mockGetOrLoad).not.toHaveBeenCalled();
  });
});
