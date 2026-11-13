/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

import { CAPSULE_MIN_DELAY_MS } from './types';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getCompletion: jest.fn(),
    createCapsule: jest.fn(),
    getCapsules: jest.fn(),
    deleteCapsule: jest.fn(),
    openCapsule: jest.fn(),
  },
}));
installWebPolyfills();
const { NextResponse } = require('next/server') as typeof import('next/server');
const {
  celebrateCompletion,
  createCapsule,
  deleteCapsule,
  getCapsules,
  getCompletion,
  openCapsule,
} = require('./api.server') as typeof import('./api.server');
const request = (path: string, value?: unknown) =>
  ({
    url: `http://localhost/api/${path}`,
    json: async () => value,
  }) as NextRequest;
beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(requireActiveUser)
    .mockResolvedValue({ username: 'alice' } as Awaited<
      ReturnType<typeof requireActiveUser>
    >);
  jest.mocked(isGuardFailure).mockReturnValue(false);
});
it('所有入口先鉴权，不调用存储', async () => {
  jest.mocked(requireActiveUser).mockResolvedValue({
    response: NextResponse.json({ error: '请登录' }, { status: 401 }),
  });
  jest.mocked(isGuardFailure).mockReturnValue(true);
  for (const handler of [
    getCompletion,
    celebrateCompletion,
    getCapsules,
    createCapsule,
  ])
    expect((await handler(request('capsules'))).status).toBe(401);
  expect(jest.mocked(db.getCompletion)).not.toHaveBeenCalled();
});
it('完结缺参数400、无记录404，读写用登录用户及完整键', async () => {
  expect((await getCompletion(request('playrecords/completion'))).status).toBe(
    400,
  );
  jest.mocked(db.getCompletion).mockResolvedValue(null);
  expect(
    (await getCompletion(request('playrecords/completion?source=a&id=1')))
      .status,
  ).toBe(404);
  jest
    .mocked(db.getCompletion)
    .mockResolvedValue({ celebrated: true } as NonNullable<
      Awaited<ReturnType<typeof db.getCompletion>>
    >);
  expect(
    await (
      await celebrateCompletion(
        request('playrecords/completion', { source: 'a', id: '1' }),
      )
    ).json(),
  ).toEqual({ ok: true });
  expect(db.getCompletion).toHaveBeenLastCalledWith('alice', 'a+1', true);
});
it('建信不接受客户端评分，非法正文返回400；列表透传游标', async () => {
  const input = {
    title: '作品',
    year: '2026',
    cover: '',
    content: '正文',
    deliverAt: Date.now() + CAPSULE_MIN_DELAY_MS + 10000,
    ratingThen: 10,
  };
  jest
    .mocked(db.createCapsule)
    .mockResolvedValue({ id: 'id' } as Awaited<
      ReturnType<typeof db.createCapsule>
    >);
  expect((await createCapsule(request('capsules', input))).status).toBe(200);
  expect(jest.mocked(db.createCapsule).mock.calls[0][1]).not.toHaveProperty(
    'ratingThen',
  );
  expect(
    (
      await createCapsule(
        request('capsules', { ...input, content: '字'.repeat(501) }),
      )
    ).status,
  ).toBe(400);
  jest
    .mocked(db.getCapsules)
    .mockResolvedValue({ pending: [], delivered: [], nextCursor: null });
  await getCapsules(request('capsules?cursor=next'));
  expect(db.getCapsules).toHaveBeenCalledWith('alice', 'next');
});
it('删除与打开仅传登录用户，存储拒绝时404；异常隐藏内部信息', async () => {
  const ctx = { params: Promise.resolve({ id: 'letter' }) };
  jest.mocked(db.deleteCapsule).mockResolvedValue(false);
  jest.mocked(db.openCapsule).mockResolvedValue(null);
  expect((await deleteCapsule(request('capsules/letter'), ctx)).status).toBe(
    404,
  );
  expect((await openCapsule(request('capsules/letter/open'), ctx)).status).toBe(
    404,
  );
  expect(db.openCapsule).toHaveBeenCalledWith('alice', 'letter');
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest
    .mocked(db.getCapsules)
    .mockRejectedValue(new Error('private database credentials'));
  const response = await getCapsules(request('capsules'));
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('credentials');
  log.mockRestore();
});
