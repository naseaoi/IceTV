/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { backupBeforeUpgrade } from '@/features/upgrade/backup.server';
import {
  isUpdaterConfigured,
  requestUpdater,
  UpdaterConflictError,
} from '@/features/upgrade/client.server';
import { requireOwner } from '@/lib/api-auth';

jest.mock('@/lib/api-auth', () => ({
  requireOwner: jest.fn(),
  isGuardFailure: (result: { response?: unknown }) => Boolean(result.response),
}));
jest.mock('@/features/upgrade/backup.server', () => ({
  backupBeforeUpgrade: jest.fn(),
}));
jest.mock('@/features/upgrade/client.server', () => ({
  isUpdaterConfigured: jest.fn(),
  requestUpdater: jest.fn(),
  UpdaterConflictError: class extends Error {},
}));
installWebPolyfills();
const { GET, POST } = require('@/app/api/admin/upgrade/route');
const owner = jest.mocked(requireOwner);
const configured = jest.mocked(isUpdaterConfigured);
const updater = jest.mocked(requestUpdater);
const backup = jest.mocked(backupBeforeUpgrade);
const status = { capable: true, job: { phase: 'pulling' as const } };
function request(
  body: unknown = { action: 'pull' },
  origin: string | null = 'https://example.test',
  host = 'example.test',
  forwardedHost?: string,
) {
  return {
    headers: new Headers({
      host,
      ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
      ...(origin === null ? {} : { origin }),
    }),
    nextUrl: new URL('https://example.test/api/admin/upgrade'),
    json: async () => body,
  } as unknown as NextRequest;
}
beforeEach(() => {
  jest.clearAllMocks();
  owner.mockResolvedValue({ username: 'owner', role: 'owner', isOwner: true });
  configured.mockReturnValue(true);
  updater.mockResolvedValue(status);
  backup.mockResolvedValue('/data/backups/test.sqlite');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
it.each([401, 403])('GET 和 POST 保留鉴权失败 %s', async (code) => {
  const response = Response.json({ error: 'forbidden' }, { status: code });
  owner.mockResolvedValue({ response: response as never });
  expect(await GET(request())).toBe(response);
  expect(await POST(request())).toBe(response);
  expect(updater).not.toHaveBeenCalled();
});
it('未配置时隐藏能力且拒绝动作', async () => {
  configured.mockReturnValue(false);
  expect(await (await GET(request())).json()).toMatchObject({
    available: false,
  });
  expect((await POST(request())).status).toBe(503);
  expect(updater).not.toHaveBeenCalled();
});
it('不可达时隐藏能力且错误信息不泄漏', async () => {
  updater.mockRejectedValue(new Error('private token'));
  expect(await (await GET(request())).json()).toEqual({
    available: false,
    reason: '升级服务暂时不可用，请稍后重试',
  });
  expect((await POST(request())).status).toBe(502);
});
it('updater 不具备能力时隐藏按钮', async () => {
  updater.mockResolvedValue({
    capable: false,
    reason: '固定版本',
    job: { phase: 'idle' },
  });
  expect(await (await GET(request())).json()).toEqual({
    available: false,
    reason: '固定版本',
  });
});
it.each([
  null,
  'null',
  'https://evil.test',
  'https://example.test.evil.test',
  'https://example.test/path',
  'https://example.test:8443',
])('拒绝错误 Origin %s', async (origin) => {
  expect((await POST(request({ action: 'restart' }, origin))).status).toBe(403);
  expect(backup).not.toHaveBeenCalled();
  expect(updater).not.toHaveBeenCalled();
});
it('反向代理后按转发主机名校验来源', async () => {
  const proxied = request(
    { action: 'pull' },
    'https://tv.example.test',
    '127.0.0.1:3000',
    'tv.example.test',
  );
  expect((await POST(proxied)).status).toBe(200);
});
it.each([null, {}, { action: 'delete' }, []])(
  '拒绝非法动作 %p',
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  },
);
it('备份失败阻断重启', async () => {
  backup.mockRejectedValue(new Error('private path'));
  const response = await POST(request({ action: 'restart' }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: '数据库备份失败，已取消重启，请检查存储空间与目录权限',
  });
  expect(updater).not.toHaveBeenCalled();
});
it('透传任务冲突 409', async () => {
  updater.mockRejectedValue(new UpdaterConflictError());
  expect((await POST(request())).status).toBe(409);
});
it('正常拉取直接调用 updater', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ available: true, status });
  expect(updater).toHaveBeenCalledWith('pull');
  expect(backup).not.toHaveBeenCalled();
});
it('正常重启先备份并保留路径供 GET 查询', async () => {
  const response = await POST(request({ action: 'restart' }));
  expect(response.status).toBe(200);
  expect(backup.mock.invocationCallOrder[0]).toBeLessThan(
    updater.mock.invocationCallOrder[0],
  );
  expect(await response.json()).toMatchObject({
    available: true,
    backupPath: '/data/backups/test.sqlite',
  });
  expect(await (await GET(request())).json()).toMatchObject({
    backupPath: '/data/backups/test.sqlite',
  });
});
it('MySQL 跳过备份时仍能重启', async () => {
  backup.mockResolvedValue(undefined);
  expect(await (await POST(request({ action: 'restart' }))).json()).toEqual({
    available: true,
    status,
  });
});
