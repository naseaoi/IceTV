import { getVideoResolutionFromM3u8 } from '@/features/play/lib/hls-utils';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import type { SourcePlaybackRoute } from '@/lib/proxy-modes';

const browserRoute: SourcePlaybackRoute = {
  useServerProxy: false,
  directManifest: true,
  allowAutoFallback: false,
};
const serverRoute: SourcePlaybackRoute = {
  useServerProxy: true,
  directManifest: false,
  allowAutoFallback: false,
};

jest.mock('@/features/play/lib/hls-utils', () => ({
  getVideoResolutionFromM3u8: jest.fn(),
}));

jest.mock('@/lib/proxy-modes', () => ({
  getSourcePlaybackRoute: jest.fn(() => ({
    useServerProxy: false,
    directManifest: true,
    allowAutoFallback: false,
  })),
  clearSourceProxyOverride: jest.fn(),
  rememberSourceServerProxy: jest.fn(),
  shouldAutoFallbackToServer: jest.fn(() => false),
}));

function createSampleResponse(size: number, ok = true, status = 206) {
  return {
    ok,
    status,
    arrayBuffer: async () => new Uint8Array(size).buffer,
  } as Response;
}

describe('probeVodEpisodeUrl', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('m3u8 地址沿用 HLS 探测', async () => {
    (getVideoResolutionFromM3u8 as jest.Mock).mockResolvedValue({
      quality: '1080p',
      loadSpeed: '1.0 MB/s',
      pingTime: 100,
    });

    await expect(
      probeVodEpisodeUrl(
        'https://example.test/index.m3u8',
        browserRoute,
        'giri',
      ),
    ).resolves.toEqual({
      quality: '1080p',
      loadSpeed: '1.0 MB/s',
      pingTime: 100,
    });
    expect(getVideoResolutionFromM3u8).toHaveBeenCalledWith(
      'https://example.test/index.m3u8',
      browserRoute,
      'giri',
      undefined,
    );
  });

  it('懒地址先解析再按 m3u8 探测', async () => {
    const lazyUrl = 'icetv-lazy://giri/playGV9-1-1/';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://cdn.example/lazy.m3u8' }),
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    (getVideoResolutionFromM3u8 as jest.Mock).mockResolvedValue({
      quality: '720p',
      loadSpeed: '2.0 MB/s',
      pingTime: 50,
    });

    await expect(
      probeVodEpisodeUrl(lazyUrl, browserRoute, 'giri'),
    ).resolves.toEqual({
      quality: '720p',
      loadSpeed: '2.0 MB/s',
      pingTime: 50,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/episode-url?source=giri&url=${encodeURIComponent(lazyUrl)}`,
      { headers: { 'X-IceTV-Probe': '1' }, signal: expect.any(AbortSignal) },
    );
    expect(getVideoResolutionFromM3u8).toHaveBeenCalledWith(
      'https://cdn.example/lazy.m3u8',
      browserRoute,
      'giri',
      undefined,
    );
  });

  it('MP4 正文中断触发一次代理回落', async () => {
    const mock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => {
          throw new TypeError('terminated');
        },
      })
      .mockResolvedValueOnce(createSampleResponse(65536));
    global.fetch = mock;
    await expect(
      probeVodEpisodeUrl(
        'https://cdn.example/a.mp4',
        { ...browserRoute, allowAutoFallback: true },
        'demo',
      ),
    ).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('mp4 地址使用 Range 样本探测', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(createSampleResponse(64 * 1024));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await probeVodEpisodeUrl(
      'https://example.test/video.mp4?token=abc',
      browserRoute,
      'giri',
    );

    expect(result).toMatchObject({
      quality: 'MP4',
      pingTime: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/video.mp4?token=abc',
      expect.objectContaining({
        headers: { Range: 'bytes=0-262143' },
      }),
    );
  });

  it('mp4 自动代理模式直连失败后回退到 segment 代理', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('direct failed'))
      .mockResolvedValueOnce(createSampleResponse(64 * 1024));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      probeVodEpisodeUrl(
        'https://example.test/video.mp4',
        {
          useServerProxy: false,
          directManifest: false,
          allowAutoFallback: true,
        },
        'giri',
      ),
    ).resolves.toMatchObject({
      quality: 'MP4',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/proxy/segment?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('icetv-source=giri');
  });

  it('服务端额度繁忙时返回暂缓而非普通播放错误', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 503 });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      probeVodEpisodeUrl('https://example.test/busy.mp4', serverRoute, 'giri'),
    ).rejects.toMatchObject({ name: 'SourceProbeDeferredError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
