import { cacheManager } from '@/lib/db.client.cache';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));

const okResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({}),
  }) as unknown as Response;

const errorResponse = () =>
  ({
    ok: false,
    status: 500,
    json: async () => ({}),
  }) as unknown as Response;

describe('messagesUpdated 派发点', () => {
  const listener = jest.fn();
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    listener.mockReset();
    localStorage.clear();
    fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
    window.addEventListener('messagesUpdated', listener);
    cacheManager.cachePlayRecords({
      'src+1': {
        title: '剧集',
        source_name: '源',
        year: '2026',
        cover: '',
        index: 1,
        total_episodes: 12,
        play_time: 0,
        total_time: 0,
        save_time: 1,
      },
    });
  });

  afterEach(() => {
    window.removeEventListener('messagesUpdated', listener);
    jest.restoreAllMocks();
  });

  it('删除播放记录后派发', async () => {
    const { deletePlayRecord } = await import('@/lib/db.client');

    await deletePlayRecord('src', '1');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playrecords?key=src%2B1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('标记追更已读后派发', async () => {
    const { markPlayRecordUpdateRead } = await import('@/lib/db.client');

    await markPlayRecordUpdateRead('src', '1');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('切换追更开关后派发', async () => {
    const { setPlayRecordTracking } = await import('@/lib/db.client');

    await setPlayRecordTracking('src', '1', false);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('清空播放记录后派发', async () => {
    const { clearAllPlayRecords } = await import('@/lib/db.client');

    await clearAllPlayRecords();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('清空播放记录失败时不派发', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(errorResponse());
    const { clearAllPlayRecords } = await import('@/lib/db.client');

    await expect(clearAllPlayRecords()).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
  });

  it('删除播放记录服务端失败时不派发，但乐观删除已广播', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const playRecordsListener = jest.fn();
    window.addEventListener('playRecordsUpdated', playRecordsListener);
    fetchMock.mockResolvedValue(errorResponse());
    const { deletePlayRecord } = await import('@/lib/db.client');

    await expect(deletePlayRecord('src', '1')).rejects.toThrow();

    expect(playRecordsListener).toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener('playRecordsUpdated', playRecordsListener);
  });
});
