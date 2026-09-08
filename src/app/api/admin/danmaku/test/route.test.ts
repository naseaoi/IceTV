import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { searchDanmakuCandidates } from '@/features/play/lib/danmaku/provider.server';
import { getConfigFresh } from '@/lib/config';

installWebPolyfills();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ username: 'admin' }),
  isGuardFailure: () => false,
}));
jest.mock('@/lib/config', () => ({ getConfigFresh: jest.fn() }));
jest.mock('@/features/play/lib/danmaku/provider.server', () => ({
  isDanmakuProviderConfigured: () => true,
  searchDanmakuCandidates: jest.fn().mockResolvedValue([{ episodeId: 123 }]),
}));

const { POST } = require('./route') as typeof import('./route');

describe('danmaku connection test runtime settings', () => {
  it.each([undefined, 8, 25])(
    'uses the saved timeout or its fallback: %p',
    async (timeout) => {
      (getConfigFresh as jest.Mock).mockResolvedValue({
        SiteConfig: {
          EnableDanmaku: true,
          DanmakuRequestTimeoutSeconds: timeout,
        },
      });
      const response = await POST({} as NextRequest);
      expect(response.status).toBe(200);
      expect(searchDanmakuCandidates).toHaveBeenLastCalledWith(
        '葬送的芙莉莲',
        (timeout ?? 12) * 1000,
      );
    },
  );
});
