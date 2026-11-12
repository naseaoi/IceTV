/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { getTrackingCalendar } from '@/features/continue-watching/lib/tracking-calendar.server';
import { requireActiveUser } from '@/lib/api-auth';

jest.mock('@/features/continue-watching/lib/tracking-calendar.server', () => ({
  getTrackingCalendar: jest.fn(),
}));
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (value: object) => 'response' in value,
}));
installWebPolyfills();
const { GET } = require('./route') as typeof import('./route');
const { NextResponse } = require('next/server') as typeof import('next/server');
const request = {} as NextRequest;
beforeEach(() => jest.clearAllMocks());
it('未登录不查询数据', async () => {
  jest.mocked(requireActiveUser).mockResolvedValue({
    response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
  });
  expect((await GET(request)).status).toBe(401);
  expect(getTrackingCalendar).not.toHaveBeenCalled();
});
it('以鉴权用户名查询且禁用响应缓存', async () => {
  jest
    .mocked(requireActiveUser)
    .mockResolvedValue({ username: 'alice' } as Awaited<
      ReturnType<typeof requireActiveUser>
    >);
  jest.mocked(getTrackingCalendar).mockResolvedValue([]);
  const response = await GET(request);
  expect(await response.json()).toEqual({ items: [] });
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(getTrackingCalendar).toHaveBeenCalledWith('alice');
});
it('兜底错误返回通用文案', async () => {
  jest
    .mocked(requireActiveUser)
    .mockResolvedValue({ username: 'alice' } as Awaited<
      ReturnType<typeof requireActiveUser>
    >);
  jest
    .mocked(getTrackingCalendar)
    .mockRejectedValue(new Error('database password secret'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const response = await GET(request);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: '追剧周历加载失败，请稍后重试',
  });
  log.mockRestore();
});
