import {
  createOptimisticWriter,
  fetchWithAuth,
  handleDatabaseOperationFailure,
} from '@/lib/db.client.internal';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

describe('createOptimisticWriter', () => {
  it('缓存缺失时不广播基于空缓存的删除结果', async () => {
    const setCached = jest.fn();
    const mutateCached = jest.fn((cached: Record<string, string>) => cached);
    const syncToServer = jest.fn().mockResolvedValue(undefined);
    const listener = jest.fn();
    window.addEventListener('playRecordsUpdated', listener);

    const write = createOptimisticWriter<Record<string, string>>({
      getCached: () => null,
      setCached,
      eventName: 'playRecordsUpdated',
      emptyCacheFactory: () => ({}),
    });

    await write({
      mutateCached,
      syncToServer,
      requireExistingCacheForOptimisticUpdate: true,
    });

    expect(mutateCached).not.toHaveBeenCalled();
    expect(setCached).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(syncToServer).toHaveBeenCalledTimes(1);

    window.removeEventListener('playRecordsUpdated', listener);
  });

  it('缓存存在时仍广播精确的乐观更新结果', async () => {
    const cached = { first: '保留', second: '删除' };
    const setCached = jest.fn();
    const syncToServer = jest.fn().mockResolvedValue(undefined);
    const listener = jest.fn();
    window.addEventListener('playRecordsUpdated', listener);

    const write = createOptimisticWriter<Record<string, string>>({
      getCached: () => cached,
      setCached,
      eventName: 'playRecordsUpdated',
      emptyCacheFactory: () => ({}),
    });

    await write({
      mutateCached: (records) => {
        delete records.second;
        return records;
      },
      syncToServer,
      requireExistingCacheForOptimisticUpdate: true,
    });

    expect(setCached).toHaveBeenCalledWith({ first: '保留' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      first: '保留',
    });
    expect(syncToServer).toHaveBeenCalledTimes(1);

    window.removeEventListener('playRecordsUpdated', listener);
  });
});

describe('数据库失败反馈', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    [0, '播放进度暂时保存失败，当前进度已保留，稍后会继续尝试'],
    [503, '播放进度暂时保存失败，服务稍后恢复后会继续尝试'],
    [400, '播放进度保存请求无效，请刷新页面后重试'],
  ])('进度保存失败状态 %s 保留原提示', async (status, message) => {
    global.fetch =
      status === 0
        ? jest.fn().mockRejectedValue(new TypeError('offline'))
        : jest.fn().mockResolvedValue({ ok: false, status });
    const error = await fetchWithAuth('/api/playrecords', {
      method: 'POST',
    }).catch((error: unknown) => error);
    await handleDatabaseOperationFailure('playRecords', error);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(message, 'error');
  });

  it.each([true, false])(
    '认证失败 authenticated=%s 保留认证提示而不追加操作错误',
    async (authenticated) => {
      jest.useFakeTimers();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 403 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            authenticated,
            reason: authenticated ? 'ok' : 'session_expired',
          }),
        });
      const error = await fetchWithAuth('/api/playrecords', {
        method: 'PATCH',
      }).catch((error: unknown) => error);
      await handleDatabaseOperationFailure(
        'playRecords',
        error,
        '标记已读失败，请重试',
      );
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).not.toHaveBeenCalledWith(
        '标记已读失败，请重试',
        'error',
      );
      jest.runOnlyPendingTimers();
    },
  );
});
