/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { getAvailableApiSites } from '@/lib/config';
import { searchFirstPageFromApi } from '@/lib/downstream';
import { getSourceHealthTiers } from '@/lib/source-health.server';

installWebPolyfills();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest
    .fn()
    .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
  isGuardFailure: (result: object) => 'response' in result,
}));

jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn().mockResolvedValue({
    SiteConfig: { DisableYellowFilter: false },
  }),
  getAvailableApiSites: jest
    .fn()
    .mockResolvedValue([
      { key: 'demo', name: 'Demo', api: 'https://example.com' },
    ]),
}));

jest.mock('@/lib/downstream', () => ({
  searchFirstPageFromApi: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthTiers: jest.fn().mockResolvedValue(new Map()),
}));

const { GET } = require('./route') as typeof import('./route');

function createRequest(url: string, signal?: AbortSignal): NextRequest {
  return { url, signal } as unknown as NextRequest;
}

describe('search suggestions route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips downstream requests for short queries', async () => {
    const response = await GET(
      createRequest('http://localhost/api/search/suggestions?q=%E5%BD%B1'),
    );

    await expect(response.json()).resolves.toEqual({ suggestions: [] });
    expect(searchFirstPageFromApi).not.toHaveBeenCalled();
  });

  it('selects the healthiest available source before taking the first site', async () => {
    (getAvailableApiSites as jest.Mock).mockResolvedValueOnce(
      ['offline', 'good'].map((key) => ({
        key,
        name: key,
        api: 'https://example.com',
      })),
    );
    (getSourceHealthTiers as jest.Mock).mockResolvedValueOnce(
      new Map([
        ['offline', 'offline'],
        ['good', 'good'],
        ['forbidden', 'good'],
      ]),
    );
    const response = await GET(
      createRequest('http://localhost/api/search/suggestions?q=test'),
    );
    expect(response.status).toBe(200);
    expect(searchFirstPageFromApi).toHaveBeenCalledTimes(1);
    expect(searchFirstPageFromApi).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'good' }),
      'test',
      { signal: undefined },
    );
  });

  it('normalizes queries and forwards the request signal', async () => {
    const controller = new AbortController();
    const response = await GET(
      createRequest(
        'http://localhost/api/search/suggestions?q=%20%E7%94%B5%E5%BD%B1%20%20%E6%8E%A8%E8%8D%90%20',
        controller.signal,
      ),
    );

    expect(response.status).toBe(200);
    expect(searchFirstPageFromApi).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'demo' }),
      '电影 推荐',
      { signal: controller.signal },
    );
  });
});
