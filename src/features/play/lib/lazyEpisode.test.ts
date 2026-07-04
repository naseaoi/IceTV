import {
  peekResolvedLazyEpisodeUrl,
  resolveLazyEpisodeUrl,
} from '@/features/play/lib/lazyEpisode';

const originalFetch = global.fetch;

function createJsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe('resolveLazyEpisodeUrl', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('非懒地址直接返回，不发请求', async () => {
    await expect(
      resolveLazyEpisodeUrl('giri', 'https://cdn.example/video.m3u8'),
    ).resolves.toBe('https://cdn.example/video.m3u8');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('解析成功并写入缓存', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      createJsonResponse({ url: 'https://cdn.example/ep1.m3u8' }),
    );
    const lazyUrl = 'icetv-lazy://giri/playGV1-1-1/';

    await expect(resolveLazyEpisodeUrl('giri', lazyUrl)).resolves.toBe(
      'https://cdn.example/ep1.m3u8',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/episode-url?source=giri&url=${encodeURIComponent(lazyUrl)}`,
    );

    expect(peekResolvedLazyEpisodeUrl('giri', lazyUrl)).toBe(
      'https://cdn.example/ep1.m3u8',
    );
    await resolveLazyEpisodeUrl('giri', lazyUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('并发解析同一地址只发一次请求', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      createJsonResponse({ url: 'https://cdn.example/ep2.m3u8' }),
    );
    const lazyUrl = 'icetv-lazy://giri/playGV2-1-1/';

    const [first, second] = await Promise.all([
      resolveLazyEpisodeUrl('giri', lazyUrl),
      resolveLazyEpisodeUrl('giri', lazyUrl),
    ]);

    expect(first).toBe('https://cdn.example/ep2.m3u8');
    expect(second).toBe('https://cdn.example/ep2.m3u8');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('解析失败抛出服务端错误信息且不缓存', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({ error: '播放地址解析失败' }, false),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ url: 'https://cdn.example/ep3.m3u8' }),
      );
    const lazyUrl = 'icetv-lazy://giri/playGV3-1-1/';

    await expect(resolveLazyEpisodeUrl('giri', lazyUrl)).rejects.toThrow(
      '播放地址解析失败',
    );
    expect(peekResolvedLazyEpisodeUrl('giri', lazyUrl)).toBeNull();

    await expect(resolveLazyEpisodeUrl('giri', lazyUrl)).resolves.toBe(
      'https://cdn.example/ep3.m3u8',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
