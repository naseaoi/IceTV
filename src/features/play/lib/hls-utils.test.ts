import { getVideoResolutionFromM3u8 } from '@/features/play/lib/hls-utils';

describe('getVideoResolutionFromM3u8', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('首分片加载失败时不返回 playlist 分辨率', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          [
            '#EXTM3U',
            '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=128,RESOLUTION=1920x1080',
            '/child.m3u8',
          ].join('\n'),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          ['#EXTM3U', '#EXTINF:2.000000,', '/segment.ts'].join('\n'),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      getVideoResolutionFromM3u8(
        'https://example.test/index.m3u8',
        true,
        'zuid',
      ),
    ).rejects.toThrow('Failed to load first segment');
  });

  it('首分片样本较小时返回测速未知而非失败', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          [
            '#EXTM3U',
            '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=128,RESOLUTION=1920x1080',
            '/child.m3u8',
          ].join('\n'),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          ['#EXTM3U', '#EXTINF:2.000000,', '/segment.ts'].join('\n'),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array(16 * 1024).buffer,
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      getVideoResolutionFromM3u8(
        'https://example.test/index.m3u8',
        true,
        'giri',
      ),
    ).resolves.toMatchObject({
      quality: '1080p',
      loadSpeed: '未知',
    });
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method !== 'HEAD'),
    ).toBe(true);
  });

  it('清单超时会取消实际请求，不遗留后台回源', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener(
            'abort',
            () => reject(new Error('timed out')),
            { once: true },
          );
        }),
    ) as typeof fetch;
    const assertion = expect(
      getVideoResolutionFromM3u8(
        'https://example.test/timeout.m3u8',
        true,
        'giri',
      ),
    ).rejects.toThrow('timed out');
    jest.advanceTimersByTime(8000);
    await assertion;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('额度繁忙不会被包装成源站失败或发起额外回退', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 503 });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      getVideoResolutionFromM3u8(
        'https://example.test/busy.m3u8',
        false,
        'giri',
      ),
    ).rejects.toMatchObject({ name: 'SourceProbeDeferredError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
