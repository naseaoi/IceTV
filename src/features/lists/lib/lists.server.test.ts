/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (value: { response?: unknown }) => !!value.response,
}));
jest.mock('@/lib/db', () => ({ db: {} }));
installCryptoPolyfill();
installWebPolyfills();
const { NextResponse } = require('next/server') as typeof import('next/server');
const { handleLists } =
  require('./lists.server') as typeof import('./lists.server');
let storage: LocalSqliteStorage;
const guard = jest.mocked(requireActiveUser);
const req = (url = '/api/lists', method = 'GET', value?: unknown) =>
  ({
    nextUrl: new URL(`http://localhost${url}`),
    method,
    json: async () => value,
  }) as NextRequest;
const context = (id: string, itemId?: string) => ({
  params: Promise.resolve({ id, itemId }),
});
beforeEach(async () => {
  storage = new LocalSqliteStorage(':memory:');
  for (const method of [
    'getLists',
    'countUserLists',
    'getList',
    'createList',
    'updateList',
    'deleteList',
    'addListItem',
    'removeListItem',
    'reorderListItems',
    'ensureUserProfile',
    'getUserProfile',
    'getUserProfileById',
  ] as const)
    Object.assign(db, { [method]: storage[method].bind(storage) });
  await storage.ensureUserProfile('alice');
  await storage.ensureUserProfile('bobby');
  guard.mockResolvedValue({ username: 'alice' } as Awaited<
    ReturnType<typeof requireActiveUser>
  >);
});
afterEach(() => {
  (storage as unknown as { db: { close(): void } }).db.close();
  jest.clearAllMocks();
});
it('每个路由动作先鉴权', async () => {
  guard.mockResolvedValue({
    response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
  });
  for (const action of [
    'collection',
    'detail',
    'items',
    'item',
    'order',
  ] as const)
    expect((await handleLists(req(), action)).status).toBe(401);
});
it('本人读取公开资料字段，他人私密和不存在统一 404', async () => {
  const list = await storage.createList('alice', { name: '私密' });
  const own = await handleLists(req(), 'detail', context(list.id));
  const detail = await own.json();
  expect(detail.owner).toMatchObject({ nickname: null, avatarSeed: null });
  expect(detail.owner).not.toHaveProperty('username');
  expect(detail).not.toHaveProperty('username');
  guard.mockResolvedValue({ username: 'bobby' } as Awaited<
    ReturnType<typeof requireActiveUser>
  >);
  const hidden = await handleLists(req(), 'detail', context(list.id));
  const missing = await handleLists(
    req(),
    'detail',
    context('00000000-0000-0000-0000-000000000000'),
  );
  expect(hidden.status).toBe(404);
  expect(await hidden.json()).toEqual(await missing.json());
  expect(
    (
      await handleLists(
        req('', 'PATCH', { name: '入侵' }),
        'detail',
        context(list.id),
      )
    ).status,
  ).toBe(404);
});
it('校验名称、简介、公开值和 JSON 体', async () => {
  for (const value of [
    { name: '' },
    { name: 'a'.repeat(31) },
    { name: 'ok', description: 'x'.repeat(201) },
    { name: 'ok', isPublic: 'true' },
    null,
    [],
  ])
    expect(
      (await handleLists(req('', 'POST', value), 'collection')).status,
    ).toBe(400);
  const invalid = {
    method: 'POST',
    json: async () => {
      throw new SyntaxError();
    },
  } as unknown as NextRequest;
  expect((await handleLists(invalid, 'collection')).status).toBe(400);
  expect(
    (await handleLists(req('/api/lists?title=title'), 'collection')).status,
  ).toBe(400);
  expect(await storage.countUserLists('alice')).toBe(0);
});
it('增删和排序返回新版本，版本冲突带 code', async () => {
  const created = await handleLists(
    req('', 'POST', { name: '片单' }),
    'collection',
  );
  const { list } = await created.json();
  const added = await handleLists(
    req('', 'POST', {
      title: '作品',
      year: '2026',
      cover: '',
      source: '',
      id: null,
    }),
    'items',
    context(list.id),
  );
  const result = await added.json();
  const conflict = await handleLists(
    req('', 'PUT', { itemIds: [result.item.id], version: list.version }),
    'order',
    context(list.id),
  );
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).code).toBe('LIST_VERSION_CONFLICT');
  const sorted = await handleLists(
    req('', 'PUT', { itemIds: [result.item.id], version: result.list.version }),
    'order',
    context(list.id),
  );
  expect(sorted.status).toBe(200);
  expect(
    (
      await handleLists(
        req('', 'DELETE'),
        'item',
        context(list.id, result.item.id),
      )
    ).status,
  ).toBe(200);
  expect(
    (await handleLists(req('', 'DELETE'), 'detail', context(list.id))).status,
  ).toBe(200);
});
it('profileId 查询本人全部、他人仅公开，作品包含条目编号', async () => {
  const profile = await storage.getUserProfile('alice');
  await storage.createList('alice', { name: '私密' });
  await storage.createList('alice', {
    name: '公开',
    isPublic: true,
    item: { title: '作品', year: '', cover: '', source: '', id: null },
  });
  const own = await handleLists(
    req(`/api/lists?profileId=${profile!.profile_id}&title=作品&year=`),
    'collection',
  );
  expect((await own.json()).lists).toHaveLength(2);
  guard.mockResolvedValue({ username: 'bobby' } as Awaited<
    ReturnType<typeof requireActiveUser>
  >);
  const other = await handleLists(
    req(`/api/lists?profileId=${profile!.profile_id}&title=作品&year=`),
    'collection',
  );
  const { lists } = await other.json();
  expect(lists).toHaveLength(1);
  expect(lists[0]).toMatchObject({
    contains: true,
    containsItemId: expect.any(String),
  });
});
