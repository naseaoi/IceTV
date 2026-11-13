/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { getOptionalActiveUser, requireActiveUser } from '@/lib/api-auth';
import { getClientIp } from '@/lib/client-ip';
import { db } from '@/lib/db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  getOptionalActiveUser: jest.fn(),
  isGuardFailure: (value: { response?: unknown }) => !!value.response,
}));
jest.mock('@/lib/client-ip', () => ({ getClientIp: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: {} }));
installCryptoPolyfill();
installWebPolyfills();
const { NextResponse } = require('next/server') as typeof import('next/server');
const { handleLists } =
  require('./lists.server') as typeof import('./lists.server');
let storage: LocalSqliteStorage;
const guard = jest.mocked(requireActiveUser);
const optionalUser = jest.mocked(getOptionalActiveUser);
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
  jest.mocked(getClientIp).mockReturnValue('203.0.113.1');
  for (const method of [
    'getWorkWatchStatuses',
    'setListLike',
    'recordListView',
    'getPlazaLists',
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
  optionalUser.mockImplementation(async (request) => {
    const result = await guard(request);
    return 'response' in result ? null : result;
  });
});
afterEach(() => {
  (storage as unknown as { db: { close(): void } }).db.close();
  jest.clearAllMocks();
});
it('除片单详情读取外，每个路由动作先鉴权', async () => {
  guard.mockResolvedValue({
    response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
  });
  for (const [action, method] of [
    ['collection', 'GET'],
    ['collection', 'POST'],
    ['detail', 'PATCH'],
    ['detail', 'DELETE'],
    ['items', 'POST'],
    ['item', 'DELETE'],
    ['order', 'PUT'],
  ] as const)
    expect((await handleLists(req('', method), action)).status).toBe(401);
});
it('游客只能读取所有人可见的片单，且不能写入', async () => {
  const members = await storage.createList('alice', {
    name: '站内',
    visibility: 'members',
  });
  const everyone = await storage.createList('alice', {
    name: '所有人',
    visibility: 'everyone',
  });
  guard.mockResolvedValue({
    response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
  });
  expect((await handleLists(req(), 'detail', context(members.id))).status).toBe(
    404,
  );
  const shared = await handleLists(req(), 'detail', context(everyone.id));
  expect(shared.status).toBe(200);
  const detail = await shared.json();
  expect(detail).toMatchObject({
    isOwner: false,
    list: { visibility: 'everyone' },
  });
  expect(detail).not.toHaveProperty('viewerProgress');
  expect(detail.owner).not.toHaveProperty('username');
  expect(
    (
      await handleLists(
        req('', 'PATCH', { name: '入侵' }),
        'detail',
        context(everyone.id),
      )
    ).status,
  ).toBe(401);
  guard.mockResolvedValue({ username: 'bobby' } as Awaited<
    ReturnType<typeof requireActiveUser>
  >);
  for (const list of [members, everyone])
    expect((await handleLists(req(), 'detail', context(list.id))).status).toBe(
      200,
    );
});
it('本人读取公开资料字段，他人私密和不存在统一 404', async () => {
  const list = await storage.createList('alice', { name: '私密' });
  const own = await handleLists(req(), 'detail', context(list.id));
  const detail = await own.json();
  expect(detail.owner).toMatchObject({ nickname: null, avatarSeed: null });
  expect(detail.viewerProgress).toEqual({
    completed: 0,
    total: 0,
    nextItemId: null,
  });
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
    { name: 'ok', visibility: 'public' },
    { name: 'ok', visibility: true },
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
    visibility: 'members',
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
  await storage.createList('alice', { name: '游客', visibility: 'everyone' });
  const { lists } = await (
    await handleLists(
      req(`/api/lists?profileId=${profile!.profile_id}&title=作品&year=`),
      'collection',
    )
  ).json();
  expect(other.status).toBe(200);
  expect(lists).toHaveLength(2);
  expect(
    lists.find((list: { name: string }) => list.name === '公开'),
  ).toMatchObject({
    contains: true,
    containsItemId: expect.any(String),
  });
});
it('作者不计数，归一化登录访客在 24 小时内只计一次且不推进版本时间', async () => {
  const list = await storage.createList('alice', {
    name: '浏览',
    visibility: 'everyone',
  });
  expect(
    (await (await handleLists(req(), 'detail', context(list.id))).json()).list,
  ).toEqual(list);
  optionalUser.mockResolvedValue({ username: 'BOBBY' } as Awaited<
    ReturnType<typeof getOptionalActiveUser>
  >);
  const now = jest.spyOn(Date, 'now');
  const time = 1_700_000_000_000;
  try {
    now.mockReturnValue(time);
    const first = await (
      await handleLists(req(), 'detail', context(list.id))
    ).json();
    expect(first.list).toEqual({ ...list, viewCount: 1 });
    optionalUser.mockResolvedValue({ username: 'bobby' } as Awaited<
      ReturnType<typeof getOptionalActiveUser>
    >);
    now.mockReturnValue(time + 24 * 60 * 60 * 1000 - 1);
    expect(
      (await (await handleLists(req(), 'detail', context(list.id))).json()).list
        .viewCount,
    ).toBe(1);
    now.mockReturnValue(time + 24 * 60 * 60 * 1000);
    expect(
      (await (await handleLists(req(), 'detail', context(list.id))).json())
        .list,
    ).toEqual({ ...list, viewCount: 2 });
  } finally {
    now.mockRestore();
  }
  expect((await storage.getList(list.id, 'alice')).list).toEqual({
    ...list,
    viewCount: 2,
  });
});
it('游客按 IP 去重，未知 IP 不计数，计数失败保留详情并允许重试', async () => {
  const list = await storage.createList('alice', {
    name: '浏览',
    visibility: 'everyone',
  });
  optionalUser.mockResolvedValue(null);
  jest.mocked(getClientIp).mockReturnValue('unknown');
  expect(
    (await (await handleLists(req(), 'detail', context(list.id))).json()).list
      .viewCount,
  ).toBe(0);
  jest.mocked(getClientIp).mockReturnValue('203.0.113.2');
  const write = jest
    .spyOn(db, 'recordListView')
    .mockRejectedValueOnce(new Error('write failed'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const failed = await handleLists(req(), 'detail', context(list.id));
    expect(failed.status).toBe(200);
    expect((await failed.json()).list.viewCount).toBe(0);
    expect(log).toHaveBeenCalled();
    for (let i = 0; i < 2; i++)
      expect(
        (await (await handleLists(req(), 'detail', context(list.id))).json())
          .list.viewCount,
      ).toBe(1);
    jest.mocked(getClientIp).mockReturnValue('203.0.113.3');
    expect(
      (await (await handleLists(req(), 'detail', context(list.id))).json()).list
        .viewCount,
    ).toBe(2);
  } finally {
    write.mockRestore();
    log.mockRestore();
  }
});
it('广场游客仅见等级 2，登录可见等级 1 和 2，跳过私密、空片单和无作者资料行', async () => {
  const item = { title: '作品', year: '', cover: '', source: '', id: null };
  await storage.createList('alice', { name: '私密', item });
  await storage.createList('alice', { name: '空', visibility: 'everyone' });
  const members = await storage.createList('alice', {
    name: '站内',
    visibility: 'members',
    item,
  });
  const everyone = await storage.createList('alice', {
    name: '游客',
    visibility: 'everyone',
    item,
  });
  await storage.ensureUserProfile('orphan');
  await storage.createList('orphan', {
    name: '无资料',
    visibility: 'everyone',
    item,
  });
  (storage as unknown as { db: { exec(sql: string): void } }).db.exec(
    "DELETE FROM user_profiles WHERE username = 'orphan'",
  );
  optionalUser.mockResolvedValue(null);
  const response = await handleLists(req('/api/lists/plaza'), 'plaza');
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const guest = await response.json();
  expect(guest.lists.map((list: { id: string }) => list.id)).toEqual([
    everyone.id,
  ]);
  expect(JSON.stringify(guest)).not.toContain('username');
  optionalUser.mockResolvedValue({ username: 'bobby' } as Awaited<
    ReturnType<typeof getOptionalActiveUser>
  >);
  const loggedIn = await (
    await handleLists(req('/api/lists/plaza'), 'plaza')
  ).json();
  expect(loggedIn.lists.map((list: { id: string }) => list.id).sort()).toEqual(
    [members.id, everyone.id].sort(),
  );
});
it.each(['hot', 'new'] as const)('广场 %s 排序和游标翻页', async (sort) => {
  const lists = [];
  const now = jest.spyOn(Date, 'now');
  try {
    for (let i = 0; i < 26; i++) {
      now.mockReturnValue(1_700_000_000_000 + i);
      const list = await storage.createList('alice', {
        name: `片单 ${i}`,
        visibility: 'everyone',
        item: { title: '作品', year: '', cover: '', source: '', id: null },
      });
      if (i < 2) await storage.recordListView(list.id);
      lists.push({ ...list, viewCount: i < 2 ? 1 : 0 });
    }
  } finally {
    now.mockRestore();
  }
  const key = sort === 'hot' ? 'viewCount' : 'updatedAt';
  lists.sort((a, b) => b[key] - a[key] || a.id.localeCompare(b.id));
  const first = await (
    await handleLists(req(`/api/lists/plaza?sort=${sort}`), 'plaza')
  ).json();
  expect(first.lists).toHaveLength(24);
  const second = await (
    await handleLists(
      req(`/api/lists/plaza?sort=${sort}&cursor=${first.nextCursor}`),
      'plaza',
    )
  ).json();
  expect(second.lists).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  expect(
    [...first.lists, ...second.lists].map((list: { id: string }) => list.id),
  ).toEqual(lists.map((list) => list.id));
});
it.each([
  'sort=bad',
  'sort=',
  'cursor=bad',
  'cursor=',
  'cursor=' + 'a'.repeat(257),
])('广场非法参数 %s 返回 400', async (query) => {
  expect(
    (await handleLists(req(`/api/lists/plaza?${query}`), 'plaza')).status,
  ).toBe(400);
});
it('片单点赞要求登录和昵称，详情返回本人点赞态且游客恒为 false', async () => {
  const list = await storage.createList('alice', {
    name: '点赞',
    visibility: 'everyone',
  });
  guard.mockResolvedValue({
    response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
  });
  for (const method of ['PUT', 'DELETE'])
    expect(
      (await handleLists(req('', method), 'like', context(list.id))).status,
    ).toBe(401);
  guard.mockResolvedValue({ username: 'bobby' } as Awaited<
    ReturnType<typeof requireActiveUser>
  >);
  for (const method of ['PUT', 'DELETE']) {
    const response = await handleLists(
      req('', method),
      'like',
      context(list.id),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('NICKNAME_REQUIRED');
  }
  await storage.updateUserProfile('bobby', { nickname: '点赞用户' });
  for (let i = 0; i < 2; i++) {
    const response = await handleLists(
      req('', 'PUT'),
      'like',
      context(list.id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ liked: true, likeCount: 1 });
  }
  expect(
    (await (await handleLists(req(), 'detail', context(list.id))).json()).liked,
  ).toBe(true);
  optionalUser.mockResolvedValue(null);
  expect(
    (await (await handleLists(req(), 'detail', context(list.id))).json()).liked,
  ).toBe(false);
  expect(
    await (
      await handleLists(req('', 'DELETE'), 'like', context(list.id))
    ).json(),
  ).toEqual({ liked: false, likeCount: 0 });
  await storage.updateList('alice', list.id, { visibility: 'private' });
  expect(
    (await handleLists(req('', 'PUT'), 'like', context(list.id))).status,
  ).toBe(404);
  await storage.updateUserProfile('alice', { nickname: '作者用户' });
  guard.mockResolvedValue({ username: 'alice' } as Awaited<
    ReturnType<typeof requireActiveUser>
  >);
  const own = await handleLists(req('', 'PUT'), 'like', context(list.id));
  expect(own.status).toBe(400);
  expect((await own.json()).error).toBe('不能给自己点赞');
});

it('登录访客的片单进度优先继续在看，游客省略私人状态', async () => {
  const list = await storage.createList('alice', {
    name: '进度',
    visibility: 'everyone',
  });
  const ids: string[] = [];
  for (const title of ['想看', '在看', '看过']) {
    const result = await storage.addListItem('alice', list.id, {
      title,
      year: '2026',
      cover: '',
      source: '',
      id: null,
    });
    ids.push(result.item.id);
  }
  await storage.setFavorite('bobby', 'source+1', {
    title: '在看',
    year: '2026',
    cover: '',
    source_name: '源',
    total_episodes: 1,
    save_time: 1,
    watch_status: 'watching',
  });
  await storage.setFavorite('bobby', 'source+2', {
    title: '看过',
    year: '2026',
    cover: '',
    source_name: '源',
    total_episodes: 1,
    save_time: 1,
    watch_status: 'completed',
  });
  guard.mockResolvedValue({ username: 'bobby' } as Awaited<
    ReturnType<typeof requireActiveUser>
  >);
  let detail = await (
    await handleLists(req(), 'detail', context(list.id))
  ).json();
  expect(detail.viewerProgress).toEqual({
    completed: 1,
    total: 3,
    nextItemId: ids[1],
  });
  expect(
    detail.items.map((item: { viewerStatus: unknown }) => item.viewerStatus),
  ).toEqual([null, 'watching', 'completed']);
  optionalUser.mockResolvedValue(null);
  detail = await (await handleLists(req(), 'detail', context(list.id))).json();
  expect(detail).not.toHaveProperty('viewerProgress');
  expect(detail.items.every((item: object) => !('viewerStatus' in item))).toBe(
    true,
  );
});
