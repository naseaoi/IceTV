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

it.each([
  ['mysql://user:secret@internal/db', '无法完成弹幕服务测试，请稍后重试'],
  [
    '安全校验拦截 https://private/?token=secret',
    '弹幕服务地址未通过安全校验，请检查服务配置',
  ],
  [
    'upstream-unavailable token=secret',
    '无法连接到弹幕服务，请检查服务地址和网络连接',
  ],
])('sanitizes diagnostic details: %s', async (message, details) => {
  (getConfigFresh as jest.Mock).mockResolvedValue({
    SiteConfig: { EnableDanmaku: true },
  });
  const error = new Error(message);
  (searchDanmakuCandidates as jest.Mock).mockRejectedValueOnce(error);
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await POST({} as NextRequest);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: '弹幕服务测试失败',
      details,
    });
    expect(log).toHaveBeenCalledWith('弹幕服务测试失败:', error);
  } finally {
    log.mockRestore();
  }
});
