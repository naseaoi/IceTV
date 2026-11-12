import {
  checkM3u8PlaylistAvailable,
  getVideoResolutionFromM3u8,
  takeProbeSegmentSample,
} from '@/features/play/lib/hls-utils';
import { reportSourceRouteStat } from '@/lib/source-route-stats.client';

jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourceRouteStat: jest.fn(),
  reportSourcePlayOutcome: jest.fn(),
}));

function createHeaders(values: Record<string, string>) {
  return {
    get: (name: string) => values[name.toLowerCase()] ?? null,
  };
}

function createStreamBody(chunks: Uint8Array[]) {
  let index = 0;
  return {
    getReader: () => ({
      read: async () =>
        index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined },
      cancel: async () => undefined,
    }),
  };
}

function playlistResponse(lines: string[]) {
  return { ok: true, status: 200, text: async () => lines.join('\n') };
}

function segmentResponse(
  chunks: Uint8Array[],
  headers: Record<string, string>,
  status = 206,
) {
  return {
    ok: true,
    status,
    headers: createHeaders(headers),
    body: createStreamBody(chunks),
  };
}

describe('takeProbeSegmentSample', () => {
  const originalFetch = global.fetch;
  const segmentUrl = 'https://cdn.example.test/video/seg-0.ts';

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('单码率清单保留测速读到的完整首分片', async () => {
    const chunks = [new Uint8Array(60_000), new Uint8Array(40_000)];
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        playlistResponse(['#EXTM3U', '#EXTINF:4.000000,', segmentUrl]),
      )
      .mockResolvedValueOnce(
        segmentResponse(chunks, { 'content-range': 'bytes 0-99999/100000' }),
      ) as unknown as typeof fetch;

    const result = await getVideoResolutionFromM3u8(
      'https://example.test/single.m3u8',
      { useServerProxy: false, directManifest: false, allowAutoFallback: true },
      'demo',
    );
    const sample = takeProbeSegmentSample(result);

    expect(sample?.url).toBe(segmentUrl);
    expect(sample?.entry).toMatchObject({
      complete: true,
      totalBytes: 100_000,
    });
    expect(sample?.entry.data.byteLength).toBe(100_000);
    expect(takeProbeSegmentSample(result)).toBeNull();
  });

  it('提前中断的样本按前缀保留并记录总长', async () => {
    const chunks = Array.from({ length: 3 }, () => new Uint8Array(200_000));
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        playlistResponse(['#EXTM3U', '#EXTINF:4.000000,', segmentUrl]),
      )
      .mockResolvedValueOnce(
        segmentResponse(chunks, {
          'content-range': 'bytes 0-1048575/3000000',
        }),
      ) as unknown as typeof fetch;

    const result = await getVideoResolutionFromM3u8(
      'https://example.test/prefix.m3u8',
      { useServerProxy: false, directManifest: false, allowAutoFallback: true },
      'demo',
    );

    expect(takeProbeSegmentSample(result)?.entry).toMatchObject({
      complete: false,
      totalBytes: 3_000_000,
    });
  });

  it.each([
    [
      '多码率清单',
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720',
        'https://example.test/720.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080',
        'https://example.test/1080.m3u8',
      ],
      segmentUrl,
    ],
  ])('%s不保留样本', async (_label, playlistLines, firstSegment) => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(playlistResponse(playlistLines));
    if (playlistLines.length > 3) {
      fetchMock.mockResolvedValueOnce(
        playlistResponse(['#EXTM3U', '#EXTINF:4.000000,', firstSegment]),
      );
    }
    fetchMock.mockResolvedValueOnce(
      segmentResponse([new Uint8Array(1_000)], {
        'content-range': 'bytes 0-999/1000',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await getVideoResolutionFromM3u8(
      'https://example.test/other.m3u8',
      { useServerProxy: false, directManifest: false, allowAutoFallback: true },
      'demo',
    );

    expect(takeProbeSegmentSample(result)).toBeNull();
  });
});

describe('checkM3u8PlaylistAvailable', () => {
  const originalFetch = global.fetch;
  const playlistUrl =
    '/api/proxy/m3u8?url=https%3A%2F%2Fexample.test%2Findex.m3u8&icetv-source=demo';

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('只取一次清单，内容是 m3u8 即判可用', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        playlistResponse(['#EXTM3U', '#EXTINF:4.000000,', '/segment.ts']),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(checkM3u8PlaylistAvailable(playlistUrl, 3000)).resolves.toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      playlistUrl,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('非 2xx 判不可用并释放响应体', async () => {
    const cancel = jest.fn(async () => undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      body: { cancel },
    }) as unknown as typeof fetch;

    await expect(checkM3u8PlaylistAvailable(playlistUrl, 3000)).resolves.toBe(
      false,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('返回内容不是 m3u8 判不可用', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        playlistResponse(['<html>', 'blocked', '</html>']),
      ) as unknown as typeof fetch;

    await expect(checkM3u8PlaylistAvailable(playlistUrl, 3000)).resolves.toBe(
      false,
    );
  });

  it('到时限即判不可用并取消请求', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    ) as typeof fetch;

    const available = checkM3u8PlaylistAvailable(playlistUrl, 3000);
    jest.advanceTimersByTime(2999);
    expect(requestSignal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);

    await expect(available).resolves.toBe(false);
    expect(requestSignal?.aborted).toBe(true);
  });
});

describe('getVideoResolutionFromM3u8', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([false, true])(
    '直连测速逐层使用重定向最终地址解析相对 URI（master=%s）',
    async (master) => {
      const rawUrl = 'https://origin.example/start.m3u8';
      const mediaUrl = 'https://media.example/final/playlist.m3u8';
      const fetchMock = jest.fn();
      if (master) {
        fetchMock.mockResolvedValueOnce({
          ...playlistResponse([
            '#EXTM3U',
            '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720',
            '../variant/index.m3u8',
          ]),
          url: 'https://master.example/redirect/root/master.m3u8',
        });
      }
      fetchMock
        .mockResolvedValueOnce({
          ...playlistResponse([
            '#EXTM3U',
            '#EXTINF:4,',
            '../segments/first.ts',
          ]),
          url: mediaUrl,
        })
        .mockResolvedValueOnce(
          segmentResponse([new Uint8Array(1000)], {
            'content-range': 'bytes 0-999/1000',
          }),
        );
      global.fetch = fetchMock;
      const result = await getVideoResolutionFromM3u8(
        rawUrl,
        {
          useServerProxy: false,
          directManifest: true,
          allowAutoFallback: false,
        },
        'demo',
      );
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        rawUrl,
        ...(master
          ? ['https://master.example/redirect/variant/index.m3u8']
          : []),
        'https://media.example/segments/first.ts',
      ]);
      expect(takeProbeSegmentSample(result)?.url).toBe(
        'https://media.example/segments/first.ts',
      );
    },
  );

  it.each(['playlist', 'segment'])(
    '直连 %s 正文中断后只回落一次代理',
    async (phase) => {
      const playlist = playlistResponse(['#EXTM3U', '#EXTINF:4,', 'seg.ts']);
      const broken = {
        ok: true,
        headers: { get: () => null },
        text: async () => {
          throw new TypeError('terminated');
        },
        body: {
          getReader: () => ({
            read: async () => {
              throw new TypeError('terminated');
            },
            cancel: async () => {},
          }),
        },
      };
      const mock = jest.fn();
      if (phase === 'segment') mock.mockResolvedValueOnce(playlist);
      mock
        .mockResolvedValueOnce(broken)
        .mockResolvedValueOnce(playlist)
        .mockResolvedValueOnce(
          segmentResponse([new Uint8Array(1000)], {
            'content-range': 'bytes 0-999/1000',
          }),
        );
      global.fetch = mock;
      await expect(
        getVideoResolutionFromM3u8(
          'https://cdn.example/video.m3u8',
          {
            useServerProxy: false,
            directManifest: true,
            allowAutoFallback: true,
          },
          'demo',
        ),
      ).resolves.toBeDefined();
      expect(
        mock.mock.calls.filter(([url]) =>
          String(url).includes('forceServer=true'),
        ),
      ).toHaveLength(1);
    },
  );

  it('显式直连失败只请求源站，不回退代理', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('CORS blocked'));
    global.fetch = fetchMock;
    await expect(
      getVideoResolutionFromM3u8(
        'https://origin.example/index.m3u8',
        {
          useServerProxy: false,
          directManifest: true,
          allowAutoFallback: false,
        },
        'demo',
      ),
    ).rejects.toThrow('CORS blocked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        {
          useServerProxy: true,
          directManifest: false,
          allowAutoFallback: false,
        },
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
        {
          useServerProxy: true,
          directManifest: false,
          allowAutoFallback: false,
        },
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
        {
          useServerProxy: true,
          directManifest: false,
          allowAutoFallback: false,
        },
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
        {
          useServerProxy: false,
          directManifest: false,
          allowAutoFallback: true,
        },
        'giri',
      ),
    ).rejects.toMatchObject({ name: 'SourceProbeDeferredError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('探测取消贯穿 fetch', () => {
  const originalFetch = global.fetch;
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it.each(['manifest', 'segment'])(
    '%s 请求取消不回落线路、不上报失败',
    async (stage) => {
      const controller = new AbortController();
      let requestSignal!: AbortSignal;
      global.fetch = jest.fn((url, init) => {
        if (stage === 'segment' && String(url).endsWith('.m3u8'))
          return Promise.resolve(
            playlistResponse([
              '#EXTM3U',
              '#EXTINF:4,',
              'https://cdn.test/segment.ts',
            ]) as Response,
          );
        requestSignal = init!.signal as AbortSignal;
        return new Promise<Response>((_, reject) => {
          requestSignal.addEventListener('abort', () =>
            reject(new DOMException('cancel', 'AbortError')),
          );
        });
      });
      const task = getVideoResolutionFromM3u8(
        'https://cdn.test/cancel.m3u8',
        {
          useServerProxy: false,
          directManifest: true,
          allowAutoFallback: true,
        },
        'cancel',
        controller.signal,
      );
      for (let i = 0; i < 20 && !requestSignal; i++) await Promise.resolve();
      const rejection = expect(task).rejects.toMatchObject({
        name: 'AbortError',
      });
      controller.abort();
      await rejection;
      expect(requestSignal.aborted).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(stage === 'manifest' ? 1 : 2);
      expect(reportSourceRouteStat).not.toHaveBeenCalled();
    },
  );

  it('离线期间的请求失败不记线路失败', async () => {
    const online = jest.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(true);
    global.fetch = jest.fn().mockImplementation(async () => {
      online.mockReturnValue(false);
      throw new TypeError('offline');
    });
    try {
      await expect(
        getVideoResolutionFromM3u8(
          'https://cdn.test/offline.m3u8',
          {
            useServerProxy: false,
            directManifest: true,
            allowAutoFallback: true,
          },
          'offline',
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(reportSourceRouteStat).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      online.mockRestore();
    }
  });
});
