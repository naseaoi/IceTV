import {
  deleteFavorite,
  getAllFavorites,
  getSkipConfig,
  isFavorited,
  readPlayRecordsForPlayback,
  reportPlaybackRecordsReadFailure,
  savePlayRecord,
} from '@/lib/db.client';
import { cacheManager } from '@/lib/db.client.cache';
import { showToast } from '@/lib/toast';
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
  jest.useRealTimers();
});

describe('readPlayRecordsForPlayback', () => {
  it('无缓存失败拒绝并共享拒绝，释放在途后允许重试，不触发全局提示', async () => {
    const error = new TypeError('offline');
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 's+1': record }),
      });
    const first = readPlayRecordsForPlayback(['s+1', 's+2']);
    const second = readPlayRecordsForPlayback(['s+2', 's+1']);
    expect(first.cached).toBeNull();
    expect(first.fresh).toBe(second.fresh);
    await expect(first.fresh).rejects.toMatchObject({
      kind: 'network',
      cause: error,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await expect(readPlayRecordsForPlayback(['s+1']).fresh).resolves.toEqual({
      's+1': record,
    });
    expect(cacheManager.getCachedPlayRecords()).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('服务端失败直接拒绝，不弹读取失败提示', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      readPlayRecordsForPlayback(['s+1']).fresh,
    ).rejects.toMatchObject({ status: 500 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('读取持续失败由播放页上报时才提示一次', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const error = await readPlayRecordsForPlayback(['s+1']).fresh.catch(
      (reason: unknown) => reason,
    );
    expect(showToast).not.toHaveBeenCalled();
    reportPlaybackRecordsReadFailure(error);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('播放进度暂时无法同步'),
      'error',
    );
  });

  it.each([undefined, 25])(
    '超时 %s 中止请求并拒绝，即使传输层一直挂起',
    async (timeoutMs) => {
      jest.useFakeTimers();
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
      const read = readPlayRecordsForPlayback(['s+1'], { timeoutMs });
      const signal = (global.fetch as jest.Mock).mock.calls[0][1]
        .signal as AbortSignal;
      const rejected = expect(read.fresh).rejects.toMatchObject({
        name: 'TimeoutError',
      });
      jest.advanceTimersByTime((timeoutMs ?? 8000) - 1);
      expect(signal.aborted).toBe(false);
      jest.advanceTimersByTime(1);
      await rejected;
      expect(signal.aborted).toBe(true);
      expect(showToast).not.toHaveBeenCalled();
    },
  );

  it('有缓存时立即提供快照，fresh 返回网络结果、合并缓存并广播', async () => {
    cacheManager.cachePlayRecords({
      's+1': record,
      's+2': record,
      's+3': record,
    });
    const pending = deferred();
    const freshRecord = { ...record, play_time: 120 };
    global.fetch = jest.fn().mockReturnValue(pending.response);
    const listener = jest.fn();
    window.addEventListener('playRecordsUpdated', listener);
    try {
      const read = readPlayRecordsForPlayback(['s+1', 's+2']);
      expect(read.cached).toEqual({ 's+1': record, 's+2': record });
      pending.resolve({ 's+1': freshRecord });
      await expect(read.fresh).resolves.toEqual({ 's+1': freshRecord });
      expect(cacheManager.getCachedPlayRecords()).toEqual({
        's+1': freshRecord,
        's+3': record,
      });
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { 's+1': freshRecord, 's+3': record },
        }),
      );
      await readPlayRecordsForPlayback(['s+1', 's+2']).fresh;
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('playRecordsUpdated', listener);
    }
  });

  it('完整缓存缺键时 cached 省略该键，fresh 仍核对网络', async () => {
    cacheManager.cachePlayRecords({ 's+2': record });
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ 's+1': record }) });
    const read = readPlayRecordsForPlayback(['s+1']);
    expect(read.cached).toEqual({});
    await expect(read.fresh).resolves.toEqual({ 's+1': record });
    expect(cacheManager.getCachedPlayRecords()).toEqual({
      's+1': record,
      's+2': record,
    });
  });

  it('有缓存时网络失败仍拒绝且保留快照', async () => {
    cacheManager.cachePlayRecords({ 's+1': record });
    const error = new Error('offline');
    global.fetch = jest.fn().mockRejectedValue(error);
    const read = readPlayRecordsForPlayback(['s+1']);
    expect(read.cached).toEqual({ 's+1': record });
    await expect(read.fresh).rejects.toMatchObject({
      kind: 'network',
      cause: error,
    });
    expect(cacheManager.getCachedPlayRecords()).toEqual(read.cached);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('期间其他键写入改变修订号时返回当前缓存，不覆盖进度', async () => {
    cacheManager.cachePlayRecords({ 's+1': record });
    const pending = deferred();
    global.fetch = jest
      .fn()
      .mockImplementation((_url, options) =>
        options?.method === 'POST'
          ? Promise.resolve({ ok: true })
          : pending.response,
      );
    const read = readPlayRecordsForPlayback(['s+1']);
    await savePlayRecord('s', '2', record);
    pending.resolve({ 's+1': { ...record, play_time: 20 } });
    await expect(read.fresh).resolves.toEqual({ 's+1': record });
    expect(cacheManager.getCachedPlayRecords()?.['s+2']).toBeDefined();
  });

  it('缓存基线变化时返回当前缓存', async () => {
    cacheManager.cachePlayRecords({ 's+1': record });
    const pending = deferred();
    global.fetch = jest.fn().mockReturnValue(pending.response);
    const read = readPlayRecordsForPlayback(['s+1']);
    const updated = { ...record, play_time: 200 };
    cacheManager.cachePlayRecords({ 's+1': updated });
    pending.resolve({ 's+1': record });
    await expect(read.fresh).resolves.toEqual({ 's+1': updated });
  });

  it.each(['success', 'failure'])(
    '账号切换后迟到的 %s 结果归空且不污染缓存',
    async (outcome) => {
      const pending = deferred();
      global.fetch = jest.fn().mockReturnValue(
        pending.response.then((response) => {
          if (outcome === 'failure') throw new Error('offline');
          return response;
        }),
      );
      const read = readPlayRecordsForPlayback(['s+1']);
      mockUsername = 'other';
      cacheManager.cachePlayRecords({ 's+2': record });
      pending.resolve({ 's+1': record });
      await expect(read.fresh).resolves.toEqual({});
      expect(cacheManager.getCachedPlayRecords()).toEqual({ 's+2': record });
    },
  );

  it('未登录或空键时返回 null 和空结果且不请求', async () => {
    global.fetch = jest.fn();
    cacheManager.cachePlayRecords({ 's+1': record });
    const empty = readPlayRecordsForPlayback([]);
    expect(empty.cached).toBeNull();
    await expect(empty.fresh).resolves.toEqual({});
    mockUsername = null;
    const guest = readPlayRecordsForPlayback(['s+1']);
    expect(guest.cached).toBeNull();
    await expect(guest.fresh).resolves.toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('候选键去重排序并按 50 键分批，各批共享中止信号', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    await readPlayRecordsForPlayback([
      ...Array.from({ length: 51 }, (_, index) => `s+${index}`),
      's+0',
    ]).fresh;
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(
      calls.map(
        ([url]) =>
          new URL(url, 'http://localhost').searchParams.getAll('keys').length,
      ),
    ).toEqual([50, 1]);
    expect(calls[0][1].signal).toBe(calls[1][1].signal);
    expect(cacheManager.getCachedPlayRecords()).toBeNull();
  });
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
