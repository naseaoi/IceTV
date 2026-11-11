import {
  deleteFavorite,
  getAllFavorites,
  getPlayRecordsByKeys,
  getSkipConfig,
  isFavorited,
} from '@/lib/db.client';
import { cacheManager } from '@/lib/db.client.cache';
import type { Favorite, PlayRecord } from '@/lib/types';

let mockUsername: string | null = 'tester';
jest.mock('@/lib/auth.client', () => ({
  AUTH_SESSION_LOST_EVENT: 'auth:lost',
  getAuthInfoFromBrowserCookie: () =>
    mockUsername ? { username: mockUsername } : null,
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
const originalFetch = global.fetch;
const favorite = { title: '作品', save_time: 1 } as Favorite;
const record = { title: '作品', save_time: 1 } as PlayRecord;
function deferred() {
  let resolve!: (data: unknown) => void;
  const promise = new Promise<unknown>((settle) => {
    resolve = settle;
  });
  return {
    resolve,
    response: promise.then((data) => ({ ok: true, json: async () => data })),
  };
}
beforeEach(() => {
  mockUsername = 'tester';
  window.dispatchEvent(new Event('auth:lost'));
  localStorage.clear();
  jest.clearAllMocks();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it('候选键去重排序、每批至多 50 条，不读取全账户列表', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) });
  await getPlayRecordsByKeys([
    ...Array.from({ length: 51 }, (_, i) => `s+${i}`),
    's+0',
  ]);
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls).toHaveLength(2);
  expect(
    calls.map(
      ([url]) =>
        new URL(url, 'http://localhost').searchParams.getAll('keys').length,
    ),
  ).toEqual([50, 1]);
  expect(cacheManager.getCachedPlayRecords()).toBeNull();
});

it('同账号相同候选集合共享冷读取，顺序不影响在途键', async () => {
  const pending = deferred();
  global.fetch = jest.fn().mockReturnValue(pending.response);
  const first = getPlayRecordsByKeys(['s+1', 's+2']);
  const second = getPlayRecordsByKeys(['s+2', 's+1']);
  pending.resolve({ 's+1': record });
  expect(await first).toEqual({ 's+1': record });
  expect(await second).toEqual({ 's+1': record });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('收藏按键存在判断、跳过配置按 source/id 读取，局部结果不冒充全量缓存', async () => {
  global.fetch = jest.fn().mockImplementation(async (input: string) => ({
    ok: true,
    json: async () =>
      input.startsWith('/api/favorites?')
        ? favorite
        : { enable: true, intro_time: 12, outro_time: 0 },
  }));
  expect(await isFavorited('s', '1')).toBe(true);
  expect(await getSkipConfig('s', '1')).toEqual({
    enable: true,
    intro_time: 12,
    outro_time: 0,
  });
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/favorites?key=s%2B1',
    undefined,
  );
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/skipconfigs?source=s&id=1',
    undefined,
  );
  expect(cacheManager.getCachedFavorites()).toBeNull();
  expect(cacheManager.getCachedSkipConfigs()).toBeNull();
});

it('全量 cache-first 后台刷新合并且结束后允许再次刷新', async () => {
  cacheManager.cacheFavorites({ 's+1': favorite });
  const pending = deferred();
  global.fetch = jest.fn().mockReturnValue(pending.response);
  expect(await getAllFavorites()).toEqual({ 's+1': favorite });
  await getAllFavorites();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  pending.resolve({});
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(cacheManager.getCachedFavorites()).toEqual({});
  await getAllFavorites();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('定向后台刷新合并且保留其他作品缓存', async () => {
  cacheManager.cacheFavorites({ 's+1': favorite, 's+2': favorite });
  const pending = deferred();
  global.fetch = jest.fn().mockReturnValue(pending.response);
  expect(await isFavorited('s', '1')).toBe(true);
  await isFavorited('s', '1');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  pending.resolve(null);
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(cacheManager.getCachedFavorites()).toEqual({ 's+2': favorite });
});

it('已有全量快照但缺当前键时立即返回，后台补入新记录', async () => {
  cacheManager.cachePlayRecords({ 's+2': record });
  const pending = deferred();
  global.fetch = jest.fn().mockReturnValue(pending.response);
  expect(await getPlayRecordsByKeys(['s+1'])).toEqual({});
  pending.resolve({ 's+1': record });
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(cacheManager.getCachedPlayRecords()).toEqual({
    's+1': record,
    's+2': record,
  });
});

it('冷读取期间取消收藏，迟到结果不能覆盖乐观删除或返回旧状态', async () => {
  const pending = deferred();
  global.fetch = jest
    .fn()
    .mockImplementation((_url, options) =>
      options?.method === 'DELETE'
        ? Promise.resolve({ ok: true })
        : pending.response,
    );
  const read = isFavorited('s', '1');
  await deleteFavorite('s', '1');
  pending.resolve(favorite);
  expect(await read).toBe(false);
  expect(cacheManager.getCachedFavorites()).toEqual({});
});

it('账号切换隔离在途与迟到结果，切回同账号也不复用旧请求', async () => {
  const a = deferred();
  const b = deferred();
  const again = deferred();
  global.fetch = jest
    .fn()
    .mockReturnValueOnce(a.response)
    .mockReturnValueOnce(b.response)
    .mockReturnValueOnce(again.response);
  const first = isFavorited('s', '1');
  mockUsername = 'other';
  const second = isFavorited('s', '1');
  mockUsername = 'tester';
  const third = isFavorited('s', '1');
  a.resolve(favorite);
  b.resolve(favorite);
  again.resolve(null);
  expect(await Promise.all([first, second, third])).toEqual([
    false,
    false,
    false,
  ]);
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(cacheManager.getCachedFavorites()).toBeNull();
});

it('失败返回空结果并释放在途，后续读取可重试', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ ok: true, json: async () => favorite });
  expect(await isFavorited('s', '1')).toBe(false);
  expect(await isFavorited('s', '1')).toBe(true);
});
