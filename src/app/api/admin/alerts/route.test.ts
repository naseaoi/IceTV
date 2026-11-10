/** @jest-environment node */

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import {
  getAdminAlerts,
  getSubscriptionAlerts,
} from '@/features/admin/lib/admin-alerts.server';
import { requireAdmin, requireOwner } from '@/lib/api-auth';

jest.mock('@/features/admin/lib/admin-alerts.server', () => ({
  getAdminAlerts: jest.fn(),
  getSubscriptionAlerts: jest.fn(),
}));
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  requireOwner: jest.fn(),
}));
installWebPolyfills();
const { NextResponse } = require('next/server') as typeof import('next/server');
const { GET } = require('./route') as typeof import('./route');

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAdminAlerts).mockResolvedValue([]);
  jest.mocked(getSubscriptionAlerts).mockResolvedValue([]);
});
const request = () =>
  ({
    url: 'http://localhost/api/admin/alerts',
  }) as import('next/server').NextRequest;

it('rejects guests and ordinary users before reading alerts', async () => {
  for (const status of [401, 403]) {
    jest.mocked(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: '权限不足' }, { status }),
    });
    expect((await GET(request())).status).toBe(status);
  }
  expect(getAdminAlerts).not.toHaveBeenCalled();
  expect(getSubscriptionAlerts).not.toHaveBeenCalled();
});
it('does not read owner-only subscription state for admins', async () => {
  jest.mocked(requireAdmin).mockResolvedValue({
    username: 'admin',
    role: 'admin',
    isAdmin: true,
    isOwner: false,
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(requireOwner).not.toHaveBeenCalled();
  expect(getSubscriptionAlerts).not.toHaveBeenCalled();
});
it('checks owner guard before including subscription alerts', async () => {
  const owner = {
    username: 'owner',
    role: 'owner' as const,
    isAdmin: true,
    isOwner: true,
  };
  jest.mocked(requireAdmin).mockResolvedValue(owner);
  jest.mocked(requireOwner).mockResolvedValue(owner);
  await GET(request());
  expect(requireOwner).toHaveBeenCalled();
  expect(getSubscriptionAlerts).toHaveBeenCalled();
});
it('does not expose raw exceptions', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest
    .mocked(requireAdmin)
    .mockRejectedValue(new Error('secret subscription token'));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: '管理员提醒暂时无法加载' });
  log.mockRestore();
});
