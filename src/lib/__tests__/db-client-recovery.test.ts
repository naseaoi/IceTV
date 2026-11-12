import {
  clearAllFavorites,
  clearSearchHistory,
  deleteFavorite,
  deletePlayRecords,
  deleteSearchHistory,
} from '@/lib/db.client';
import { cacheManager } from '@/lib/db.client.cache';
import { showToast } from '@/lib/toast';
import type { Favorite, PlayRecord } from '@/lib/types';

jest.mock('@/lib/auth.client', () => ({
  AUTH_SESSION_LOST_EVENT: 'auth:lost',
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
const originalFetch = global.fetch;
const favorite = { title: '作品', save_time: 1 } as Favorite;
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});
it.each([deleteFavorite.bind(null, 's', '1'), clearAllFavorites])(
  '取消收藏和清空收藏网络失败恢复条目',
  async (run) => {
    cacheManager.cacheFavorites({ 's+1': favorite });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('offline'));
    await expect(run()).rejects.toThrow();
    expect(cacheManager.getCachedFavorites()).toEqual({ 's+1': favorite });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  },
);
it.each([deleteSearchHistory.bind(null, 'a'), clearSearchHistory])(
  '搜索历史删除失败恢复关键词',
  async (run) => {
    cacheManager.cacheSearchHistory(['a', 'b']);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 });
    await expect(run()).rejects.toThrow();
    expect(cacheManager.getCachedSearchHistory()).toEqual(['a', 'b']);
  },
);
it('批量删除后续批失败仅恢复失败批，成功批保持删除并报告数量', async () => {
  const keys = Array.from({ length: 201 }, (_, index) => `s+${index}`);
  cacheManager.cachePlayRecords(
    Object.fromEntries(
      keys.map((key) => [key, { title: key, save_time: 1 } as PlayRecord]),
    ),
  );
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(deletePlayRecords(keys)).rejects.toThrow();
  expect(Object.keys(cacheManager.getCachedPlayRecords() ?? {})).toEqual([
    's+200',
  ]);
  expect(showToast).toHaveBeenCalledWith(
    '已删除 200 条，1 条未删除，请重试',
    'error',
  );
});
