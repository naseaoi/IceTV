/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import {
  isLiveEntryEnabledInConfig,
  refreshLiveChannelSources,
} from '@/features/live/lib/live';
import { getConfigForRead } from '@/lib/config';

installWebPolyfills();
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ username: 'admin' }),
  isGuardFailure: () => false,
}));
jest.mock('@/lib/api-config-error', () => ({
  configConflictResponse: () => null,
}));
jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/features/live/lib/live', () => ({
  isLiveEntryEnabledInConfig: jest.fn(),
  refreshLiveChannelSources: jest.fn(),
}));
const { POST } = require('@/app/api/admin/live/refresh/route');

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getConfigForRead).mockResolvedValue({ LiveConfig: [] } as never);
  jest.mocked(isLiveEntryEnabledInConfig).mockReturnValue(true);
});
it('返回成功数量与失败源，不伪报全成功', async () => {
  const result = {
    refreshed: 1,
    failed: [{ key: 'bad', name: '失败源' }],
  };
  jest.mocked(refreshLiveChannelSources).mockResolvedValue(result);
  const response = await POST({} as NextRequest);
  expect(await response.json()).toEqual(result);
});
it('直播关闭直接跳过', async () => {
  jest.mocked(isLiveEntryEnabledInConfig).mockReturnValue(false);
  const response = await POST({} as NextRequest);
  expect(await response.json()).toEqual({
    refreshed: 0,
    failed: [],
    liveDisabled: true,
  });
  expect(refreshLiveChannelSources).not.toHaveBeenCalled();
});
it('异常只返回可展示错误', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest
    .mocked(refreshLiveChannelSources)
    .mockRejectedValueOnce(new Error('secret'));
  const response = await POST({} as NextRequest);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: '刷新失败' });
  log.mockRestore();
});
