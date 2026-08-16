import { createOptimisticWriter } from '@/lib/db.client.internal';

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
      mutateLocal: (stored) => stored,
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
      mutateLocal: (stored) => stored,
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
