import { getVideoResolutionFromM3u8 } from '@/features/play/lib/hls-utils';

import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';

jest.mock('@/features/play/lib/hls-utils', () => ({
  getVideoResolutionFromM3u8: jest.fn(),
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
      probeVodEpisodeUrl('https://example.test/index.m3u8', false, 'giri'),
    ).resolves.toEqual({
      quality: '1080p',
      loadSpeed: '1.0 MB/s',
      pingTime: 100,
    });
    expect(getVideoResolutionFromM3u8).toHaveBeenCalledWith(
      'https://example.test/index.m3u8',
      false,
      'giri',
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

    await expect(probeVodEpisodeUrl(lazyUrl, false, 'giri')).resolves.toEqual({
      quality: '720p',
      loadSpeed: '2.0 MB/s',
      pingTime: 50,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/episode-url?source=giri&url=${encodeURIComponent(lazyUrl)}`,
    );
    expect(getVideoResolutionFromM3u8).toHaveBeenCalledWith(
      'https://cdn.example/lazy.m3u8',
      false,
      'giri',
    );
  });

  it('mp4 地址使用 Range 样本探测', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(createSampleResponse(64 * 1024));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await probeVodEpisodeUrl(
      'https://example.test/video.mp4?token=abc',
      false,
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

  it('mp4 直连失败后回退到 segment 代理', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('direct failed'))
      .mockResolvedValueOnce(createSampleResponse(64 * 1024));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      probeVodEpisodeUrl('https://example.test/video.mp4', false, 'giri'),
    ).resolves.toMatchObject({
      quality: 'MP4',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/proxy/segment?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('icetv-source=giri');
  });
});
