import {
  createCacheFirstReader,
  createOptimisticWriter,
  fetchWithAuth,
} from '@/lib/db.client.internal';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
jest.mock('@/lib/auth.client', () => ({
  AUTH_SESSION_LOST_EVENT: 'auth:lost',
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  let cache: Record<string, string> = { a: 'old-a', b: 'old-b' };
  const writer = createOptimisticWriter<Record<string, string>>({
    getCached: () => cache,
    setCached: (next) => {
      cache = next;
    },
    emptyCacheFactory: () => ({}),
    eventName: 'favoritesUpdated',
  });
  const remove = (key: string, task: Promise<void>) =>
    writer({
      affectedKeys: [key],
      mutateCached: (value) => {
        delete value[key];
        return value;
      },
      syncToServer: () => task,
    });
  return { writer, remove, cache: () => cache };
}
afterEach(() => jest.restoreAllMocks());

it('成功删除保留新状态', async () => {
  const state = setup();
  await state.remove('a', Promise.resolve());
  expect(state.cache()).toEqual({ b: 'old-b' });
});
it.each([0, 400, 503])(
  '网络或 HTTP %s 失败只恢复受影响条目并广播',
  async (status) => {
    global.fetch = status
      ? jest.fn().mockResolvedValue({ ok: false, status })
      : jest.fn().mockRejectedValue(new TypeError('offline'));
    const state = setup();
    const listener = jest.fn();
    window.addEventListener('favoritesUpdated', listener);
    try {
      await expect(
        state.remove(
          'a',
          fetchWithAuth('/api/favorites', { method: 'DELETE' }).then(() => {}),
        ),
      ).rejects.toThrow();
      expect(state.cache()).toEqual({ a: 'old-a', b: 'old-b' });
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('favoritesUpdated', listener);
    }
  },
);
it.each(['a', 'b'])('A 失败不回滚后续成功的 %s 删除', async (secondKey) => {
  const state = setup();
  const a = deferred();
  const pending = state.remove('a', a.promise);
  const rejected = expect(pending).rejects.toThrow();
  await state.remove(secondKey, Promise.resolve());
  a.reject(new Error('failed'));
  await rejected;
  expect(state.cache()).toEqual(
    secondKey === 'a' ? { b: 'old-b' } : { a: 'old-a' },
  );
});
it('清空失败不抹掉期间新增的条目', async () => {
  const state = setup();
  const a = deferred();
  const pending = state.writer({
    affectedKeys: 'all',
    mutateCached: () => ({}),
    syncToServer: () => a.promise,
  });
  const rejected = expect(pending).rejects.toThrow();
  await state.writer({
    affectedKeys: ['b'],
    mutateCached: (value) => ({ ...value, b: 'new-b' }),
    syncToServer: async () => {},
  });
  a.reject(new Error('failed'));
  await rejected;
  expect(state.cache()).toEqual({ a: 'old-a', b: 'new-b' });
});
it('后续成功清空覆盖之前仍在途的删除', async () => {
  const state = setup();
  const a = deferred();
  const pending = state.remove('a', a.promise);
  const rejected = expect(pending).rejects.toThrow();
  await state.writer({
    affectedKeys: 'all',
    mutateCached: () => ({}),
    syncToServer: async () => {},
  });
  a.reject(new Error('failed'));
  await rejected;
  expect(state.cache()).toEqual({});
});
it('自动播放进度保留最新值', async () => {
  const state = setup();
  await expect(
    state.writer({
      rollbackOnError: false,
      mutateCached: (value) => ({ ...value, a: 'new' }),
      syncToServer: async () => {
        throw new Error('offline');
      },
    }),
  ).rejects.toThrow();
  expect(state.cache().a).toBe('new');
});
it('搜索历史以关键词恢复，不整份回滚', async () => {
  let cache = ['a', 'b'];
  const a = deferred();
  const writer = createOptimisticWriter({
    getCached: () => cache,
    setCached: (next) => {
      cache = next;
    },
    emptyCacheFactory: () => [] as string[],
    eventName: 'searchHistoryUpdated',
  });
  const pending = writer({
    affectedKeys: ['a'],
    mutateCached: (value) => value.filter((key) => key !== 'a'),
    syncToServer: () => a.promise,
  });
  const rejected = expect(pending).rejects.toThrow();
  await writer({
    affectedKeys: ['c'],
    mutateCached: (value) => ['c', ...value],
    syncToServer: async () => {},
  });
  a.reject(new Error('failed'));
  await rejected;
  expect(cache).toEqual(expect.arrayContaining(['a', 'b', 'c']));
});
it.each([null, { a: 'cached' }])('只有无缓存首读失败提示', async (cached) => {
  jest.mocked(showToast).mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const read = createCacheFirstReader<Record<string, string>>({
    getCached: () => cached,
    setCached: jest.fn(),
    fetchApi: async () => {
      throw new TypeError('offline');
    },
    fallback: {},
    eventName: 'favoritesUpdated',
  });
  await read();
  await Promise.resolve();
  expect(showToast).toHaveBeenCalledTimes(cached ? 0 : 1);
});
