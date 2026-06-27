import { getVideoResolutionFromM3u8 } from '@/lib/hls-utils';

describe('getVideoResolutionFromM3u8', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('首分片加载失败时不返回 playlist 分辨率', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true })
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
});
