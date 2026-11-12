/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import type { SiteAnnouncement } from '@/lib/types';

jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  isGuardFailure: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    listAnnouncements: jest.fn(),
    getAnnouncement: jest.fn(),
    createAnnouncement: jest.fn(),
    updateAnnouncement: jest.fn(),
    deleteAnnouncement: jest.fn(),
  },
}));
installWebPolyfills();
installCryptoPolyfill();

const { GET, POST, PATCH, DELETE } =
  require('./route') as typeof import('./route');

const mocked = db as jest.Mocked<typeof db>;
const draft: SiteAnnouncement = {
  id: 'a1',
  content: '新功能上线',
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: null,
};

const request = (body?: unknown) =>
  ({
    json: () =>
      body === undefined
        ? Promise.reject(new Error('no body'))
        : Promise.resolve(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ username: 'admin' });
  (isGuardFailure as unknown as jest.Mock).mockReturnValue(false);
  mocked.getAnnouncement.mockResolvedValue(draft);
  mocked.updateAnnouncement.mockImplementation((id, patch) =>
    Promise.resolve({ ...draft, id, ...patch }),
  );
  mocked.deleteAnnouncement.mockResolvedValue(true);
  mocked.listAnnouncements.mockResolvedValue([draft]);
});

it('非管理员被拒绝且不触达存储', async () => {
  const denied = { status: 403 };
  (requireAdmin as jest.Mock).mockResolvedValue({ response: denied });
  (isGuardFailure as unknown as jest.Mock).mockReturnValue(true);
  expect((await GET(request())).status).toBe(403);
  expect((await POST(request({ content: 'x' }))).status).toBe(403);
  expect(mocked.listAnnouncements).not.toHaveBeenCalled();
  expect(mocked.createAnnouncement).not.toHaveBeenCalled();
});

it('保存草稿不写推送时间，直接推送写入当前时间', async () => {
  const saved = await POST(request({ content: '  草稿  ' }));
  expect(saved.status).toBe(201);
  expect(mocked.createAnnouncement).toHaveBeenLastCalledWith(
    expect.objectContaining({ content: '草稿', publishedAt: null }),
  );

  await POST(request({ content: '推送', publish: true }));
  const pushed = mocked.createAnnouncement.mock.calls[1][0];
  expect(pushed.publishedAt).toEqual(expect.any(Number));
  expect(pushed.publishedAt).toBe(pushed.createdAt);
});

it('拒绝空内容、超长内容与无效参数', async () => {
  expect((await POST(request({ content: '   ' }))).status).toBe(400);
  expect((await POST(request({ content: 'x'.repeat(2001) }))).status).toBe(400);
  expect((await PATCH(request({ id: 'a1', action: 'bogus' }))).status).toBe(
    400,
  );
  expect((await DELETE(request({}))).status).toBe(400);
  expect(mocked.createAnnouncement).not.toHaveBeenCalled();
});

it('修改正文不改变推送时间', async () => {
  await PATCH(request({ id: 'a1', content: '修正错别字' }));
  expect(mocked.updateAnnouncement).toHaveBeenCalledWith('a1', {
    content: '修正错别字',
    updatedAt: expect.any(Number),
  });
});

it('推送只作用于草稿，已推送的公告不刷新推送时间', async () => {
  await PATCH(request({ id: 'a1', action: 'publish' }));
  expect(mocked.updateAnnouncement).toHaveBeenCalledWith('a1', {
    publishedAt: expect.any(Number),
    updatedAt: expect.any(Number),
  });

  mocked.updateAnnouncement.mockClear();
  mocked.getAnnouncement.mockResolvedValue({ ...draft, publishedAt: 5_000 });
  const response = await PATCH(request({ id: 'a1', action: 'publish' }));
  expect(response.status).toBe(200);
  expect((await response.json()).announcement.publishedAt).toBe(5_000);
  expect(mocked.updateAnnouncement).not.toHaveBeenCalled();
});

it('撤回清空推送时间，不存在的公告返回 404', async () => {
  await PATCH(request({ id: 'a1', action: 'withdraw' }));
  expect(mocked.updateAnnouncement).toHaveBeenCalledWith('a1', {
    publishedAt: null,
    updatedAt: expect.any(Number),
  });

  mocked.updateAnnouncement.mockResolvedValue(null);
  expect((await PATCH(request({ id: 'x', action: 'withdraw' }))).status).toBe(
    404,
  );
  mocked.deleteAnnouncement.mockResolvedValue(false);
  expect((await DELETE(request({ id: 'x' }))).status).toBe(404);
});
