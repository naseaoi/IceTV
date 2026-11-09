/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
installWebPolyfills();
const { GET } = require('./route') as typeof import('./route');

beforeEach(() => {
  jest.clearAllMocks();
  (requireActiveUser as jest.Mock).mockResolvedValue({ username: 'alice' });
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SourceConfig: [
      { key: 'auto-blocked' },
      { key: 'auto-ok', proxyMode: 'auto' },
      { key: 'browser-blocked', proxyMode: 'browser' },
      { key: 'server-ok', proxyMode: 'server' },
      { key: 'hidden', proxyMode: 'auto' },
    ],
  });
  (getAvailableApiSites as jest.Mock).mockResolvedValue(
    ['auto-blocked', 'auto-ok', 'browser-blocked', 'server-ok'].map((key) => ({
      key,
    })),
  );
});

it('returns configured modes and defaults without rewriting auto', async () => {
  const response = await GET({} as NextRequest);
  await expect(response.json()).resolves.toEqual({
    'auto-blocked': 'auto',
    'auto-ok': 'auto',
    'browser-blocked': 'browser',
    'server-ok': 'server',
  });
});
