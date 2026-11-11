import {
  createFragmentMemoryCache,
  FragmentMemoryCacheLoader,
} from '@/features/play/lib/fragmentMemoryCache';
import {
  type NextEpisodePreloadConditions,
  type NextEpisodePreloadOptions,
  type PreloadFetcher,
  cancelNextEpisodePreload,
  getForwardBufferSeconds,
  NEXT_EPISODE_PRELOAD_LIMITS,
  preloadEpisodeFragments,
  scheduleNextEpisodePreload,
  selectPreloadSegmentUrls,
  selectPreloadVariantUrl,
  shouldStartNextEpisodePreload,
  shouldWarmUpNextEpisode,
} from '@/features/play/lib/nextEpisodePreload';
import * as proxyModes from '@/lib/proxy-modes';

jest.mock('@/lib/proxy-modes', () => {
  const actual = jest.requireActual('@/lib/proxy-modes');
  return {
    ...actual,
    resolveSourcePlaybackRoute: jest.fn(actual.resolveSourcePlaybackRoute),
  };
});

const MB = 1024 * 1024;
const CDN = 'https://cdn.example.com/show/';
const NEXT_EPISODE_URL = `${CDN}ep2/index.m3u8`;

function createRanges(ranges: Array<[number, number]>) {
  return {
    length: ranges.length,
    start: (index: number) => ranges[index][0],
    end: (index: number) => ranges[index][1],
  };
}

function conditions(
  overrides: Partial<NextEpisodePreloadConditions> = {},
): NextEpisodePreloadConditions {
  return {
    autoPlayNext: true,
    currentTime: 1_450,
    duration: 1_500,
    outroSeconds: 0,
    bufferedAheadSeconds: 30,
    saveData: false,
    ...overrides,
  };
}

function mediaPlaylist(count: number, uriPrefix = '') {
  const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:10'];
  for (let index = 0; index < count; index += 1) {
    lines.push('#EXTINF:10.000,', `${uriPrefix}seg-${index}.ts`);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

function masterPlaylist(toUri: (path: string) => string = (path) => path) {
  return [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    toUri('low/index.m3u8'),
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720',
    toUri('mid/index.m3u8'),
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
    toUri('high/index.m3u8'),
  ].join('\n');
}

const MASTER_PLAYLIST = masterPlaylist();

// m3u8 代理会把嵌套清单改写成带原地址的绝对代理地址
function proxied(target: string) {
  const params = new URLSearchParams({
    url: target,
    allowCORS: 'true',
    'icetv-source': 'giri',
  });
  return `http://localhost/api/proxy/m3u8?${params.toString()}`;
}

function upstreamTarget(url: string) {
  const parsed = new URL(url);
  return parsed.pathname === '/api/proxy/m3u8'
    ? (parsed.searchParams.get('url') ?? url)
    : url;
}

type FakeResponseInit = {
  status?: number;
  text?: string;
  bytes?: number;
  headers?: Record<string, string>;
};

function fakeResponse(url: string, init: FakeResponseInit) {
  const status = init.status ?? 200;
  const headers = new Map(
    Object.entries({
      ...(init.bytes !== undefined
        ? { 'content-length': String(init.bytes) }
        : {}),
      ...init.headers,
    }).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => init.text ?? '',
    arrayBuffer: async () => new Uint8Array(init.bytes ?? 0).buffer,
  };
}

function createFetcher(routes: (url: string) => FakeResponseInit | null) {
  const requested: string[] = [];
  const fetcher: PreloadFetcher = async (url) => {
    requested.push(url);
    const route = routes(url);
    return fakeResponse(url, route ?? { status: 404 });
  };
  return { fetcher, requested };
}

describe('shouldStartNextEpisodePreload', () => {
  it('starts within the last minute when the buffer is healthy', () => {
    expect(shouldStartNextEpisodePreload(conditions())).toBe(true);
  });

  it.each<[string, Partial<NextEpisodePreloadConditions>]>([
    ['autoplay next is off', { autoPlayNext: false }],
    ['data saver is on', { saveData: true }],
    ['more than a minute remains', { currentTime: 1_400 }],
    ['playback already reached the end', { currentTime: 1_500 }],
    ['the buffer is thin', { bufferedAheadSeconds: 5 }],
    ['the duration is unknown', { duration: Number.NaN }],
    ['the duration is infinite', { duration: Number.POSITIVE_INFINITY }],
  ])('does not start when %s', (_label, overrides) => {
    expect(shouldStartNextEpisodePreload(conditions(overrides))).toBe(false);
  });

  it('counts the remaining time up to the skipped outro', () => {
    expect(
      shouldStartNextEpisodePreload(
        conditions({ currentTime: 1_350, outroSeconds: 90 }),
      ),
    ).toBe(true);
    expect(
      shouldStartNextEpisodePreload(
        conditions({ currentTime: 1_300, outroSeconds: 90 }),
      ),
    ).toBe(false);
  });

  it('relaxes the buffer requirement right before the end', () => {
    expect(
      shouldStartNextEpisodePreload(
        conditions({ currentTime: 1_492, bufferedAheadSeconds: 7.6 }),
      ),
    ).toBe(true);
  });
});

describe('shouldWarmUpNextEpisode', () => {
  const base = {
    autoPlayNext: true,
    currentTime: 3,
    bufferedAheadSeconds: NEXT_EPISODE_PRELOAD_LIMITS.healthyBufferSeconds,
    saveData: false,
  };

  it('当前集已起播且缓冲稳定时预热', () => {
    expect(shouldWarmUpNextEpisode(base)).toBe(true);
  });

  it('未起播、缓冲不足、关闭连播或省流量时不预热', () => {
    expect(shouldWarmUpNextEpisode({ ...base, currentTime: 0 })).toBe(false);
    expect(shouldWarmUpNextEpisode({ ...base, bufferedAheadSeconds: 5 })).toBe(
      false,
    );
    expect(shouldWarmUpNextEpisode({ ...base, autoPlayNext: false })).toBe(
      false,
    );
    expect(shouldWarmUpNextEpisode({ ...base, saveData: true })).toBe(false);
  });
});

describe('getForwardBufferSeconds', () => {
  it('measures the buffered range ahead and bridges tiny gaps', () => {
    expect(
      getForwardBufferSeconds({
        currentTime: 100,
        buffered: createRanges([
          [0, 20],
          [90, 110],
          [110.2, 130],
          [140, 150],
        ]),
      }),
    ).toBeCloseTo(30);
  });

  it('returns zero when the playhead is not buffered', () => {
    expect(
      getForwardBufferSeconds({
        currentTime: 50,
        buffered: createRanges([[60, 90]]),
      }),
    ).toBe(0);
  });
});

describe('playlist selection', () => {
  it('picks the variant closest to the current level bitrate', () => {
    expect(
      selectPreloadVariantUrl(MASTER_PLAYLIST, `${CDN}master.m3u8`, 2_300_000),
    ).toBe(`${CDN}mid/index.m3u8`);
    expect(
      selectPreloadVariantUrl(MASTER_PLAYLIST, `${CDN}master.m3u8`, 9_000_000),
    ).toBe(`${CDN}high/index.m3u8`);
  });

  it('does not guess among variants without a current level', () => {
    expect(
      selectPreloadVariantUrl(MASTER_PLAYLIST, `${CDN}master.m3u8`, null),
    ).toBeNull();
  });

  it('uses the only variant of a single bitrate master playlist', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000',
      'https://cdn.example.com/only.m3u8',
    ].join('\n');
    expect(selectPreloadVariantUrl(master, `${CDN}master.m3u8`, null)).toBe(
      'https://cdn.example.com/only.m3u8',
    );
  });

  it('takes the head segments and resolves relative urls', () => {
    expect(
      selectPreloadSegmentUrls(mediaPlaylist(6), `${CDN}ep2/index.m3u8`, 0),
    ).toEqual([
      `${CDN}ep2/seg-0.ts`,
      `${CDN}ep2/seg-1.ts`,
      `${CDN}ep2/seg-2.ts`,
    ]);
  });

  it('keeps the first segment and continues from the skipped intro', () => {
    expect(
      selectPreloadSegmentUrls(mediaPlaylist(6), `${CDN}ep2/index.m3u8`, 25),
    ).toEqual([
      `${CDN}ep2/seg-0.ts`,
      `${CDN}ep2/seg-2.ts`,
      `${CDN}ep2/seg-3.ts`,
    ]);
  });

  it('skips byte range playlists', () => {
    const playlist = mediaPlaylist(3).replace(
      '#EXTINF:10.000,',
      '#EXTINF:10.000,\n#EXT-X-BYTERANGE:1000@0',
    );
    expect(
      selectPreloadSegmentUrls(playlist, `${CDN}ep2/index.m3u8`, 0),
    ).toEqual([]);
  });
});

describe('preloadEpisodeFragments', () => {
  function run(
    fetcher: PreloadFetcher,
    overrides: Partial<Parameters<typeof preloadEpisodeFragments>[0]> = {},
  ) {
    const cache = createFragmentMemoryCache({ maxBytes: 64 * MB });
    const controller = new AbortController();
    const result = preloadEpisodeFragments({
      sourceKey: 'giri',
      episodeUrl: NEXT_EPISODE_URL,
      targetBitrate: 2_000_000,
      startOffsetSeconds: 0,
      filterAds: false,
      signal: controller.signal,
      cache,
      fetcher,
      ...overrides,
    });
    return { cache, controller, result };
  }

  it.each([true, false])(
    'rycj 预载按开关 %s 过滤并使用最终清单地址',
    async (filterAds) => {
      const finalUrl = 'https://final.example/redirected/index.m3u8';
      const lines = ['#EXTM3U'];
      for (let block = 0; block < 6; block++) {
        lines.push('#EXT-X-DISCONTINUITY');
        for (let fragment = 0; fragment < 3; fragment++) {
          lines.push(`#EXTINF:${4.173 + fragment * 0.113},`);
          lines.push(
            block === 0
              ? `https://other.example/clip-${fragment}.ts`
              : `../media/${block}-${fragment}.ts`,
          );
        }
      }
      lines.push('#EXT-X-ENDLIST');
      const requested: string[] = [];
      const fetcher: PreloadFetcher = async (url) => {
        requested.push(url);
        return upstreamTarget(url) === NEXT_EPISODE_URL
          ? fakeResponse(finalUrl, { text: lines.join('\n') })
          : fakeResponse(url, { bytes: 100 });
      };
      const { result } = run(fetcher, { sourceKey: 'rycj', filterAds });
      await expect(result).resolves.toBe(3);
      expect(requested.slice(1)).toEqual(
        Array.from({ length: 3 }, (_, fragment) =>
          filterAds
            ? `https://final.example/media/1-${fragment}.ts`
            : `https://other.example/clip-${fragment}.ts`,
        ),
      );
    },
  );

  it('直连预载保留分片缓存并按每层最终地址解析相对路径', async () => {
    const route = jest
      .mocked(proxyModes.resolveSourcePlaybackRoute)
      .mockResolvedValueOnce({
        useServerProxy: false,
        directManifest: true,
        allowAutoFallback: false,
      });
    try {
      const requested: string[] = [];
      const fetcher: PreloadFetcher = async (url) => {
        requested.push(url);
        if (url === NEXT_EPISODE_URL)
          return fakeResponse('https://master.example/final/index.m3u8', {
            text: masterPlaylist(),
          });
        if (url === 'https://master.example/final/mid/index.m3u8')
          return fakeResponse('https://media.example/redirect/index.m3u8', {
            text: mediaPlaylist(3, '../segments/'),
          });
        return fakeResponse(url, { bytes: 100 });
      };
      const { cache, result } = run(fetcher);
      await expect(result).resolves.toBe(3);
      expect(requested).toEqual([
        NEXT_EPISODE_URL,
        'https://master.example/final/mid/index.m3u8',
        ...Array.from(
          { length: 3 },
          (_, i) => `https://media.example/segments/seg-${i}.ts`,
        ),
      ]);
      expect(cache.has('https://media.example/segments/seg-0.ts')).toBe(true);
    } finally {
      route.mockImplementation(
        jest.requireActual('@/lib/proxy-modes').resolveSourcePlaybackRoute,
      );
    }
  });

  it('stores the head segments of the matching variant as complete entries', async () => {
    const { fetcher, requested } = createFetcher((url) => {
      const target = upstreamTarget(url);
      if (target === NEXT_EPISODE_URL) {
        return { text: masterPlaylist((path) => proxied(`${CDN}${path}`)) };
      }
      if (target === `${CDN}mid/index.m3u8`) {
        return { text: mediaPlaylist(6, `${CDN}mid/`) };
      }
      if (target.startsWith(`${CDN}mid/seg-`)) return { bytes: 1_000 };
      return null;
    });

    const { cache, result } = run(fetcher);

    await expect(result).resolves.toBe(3);
    expect(requested[0]).toBe(NEXT_EPISODE_URL);
    expect(requested.slice(1).map(upstreamTarget)).toEqual([
      `${CDN}mid/index.m3u8`,
      `${CDN}mid/seg-0.ts`,
      `${CDN}mid/seg-1.ts`,
      `${CDN}mid/seg-2.ts`,
    ]);
    expect(cache.take(`${CDN}mid/seg-1.ts`)).toMatchObject({
      complete: true,
      totalBytes: 1_000,
    });
  });

  it('stops before exceeding the byte budget', async () => {
    const segmentBytes = 5 * MB;
    const { fetcher } = createFetcher((url) => {
      if (upstreamTarget(url) === NEXT_EPISODE_URL) {
        return { text: mediaPlaylist(6, `${CDN}ep2/`) };
      }
      if (url.startsWith(`${CDN}ep2/seg-`)) return { bytes: segmentBytes };
      return null;
    });

    const { cache, result } = run(fetcher);

    await expect(result).resolves.toBe(
      Math.floor(NEXT_EPISODE_PRELOAD_LIMITS.maxBytes / segmentBytes),
    );
    expect(cache.getUsage().bytes).toBeLessThanOrEqual(
      NEXT_EPISODE_PRELOAD_LIMITS.maxBytes,
    );
  });

  it('skips non-hls episodes and failed playlists', async () => {
    const { fetcher, requested } = createFetcher(() => ({ status: 500 }));

    await expect(
      run(fetcher, { episodeUrl: `${CDN}ep2.mp4` }).result,
    ).resolves.toBe(0);
    expect(requested).toEqual([]);
    await expect(run(fetcher).result).resolves.toBe(0);
    expect(requested).toHaveLength(1);
  });

  it('stops writing once aborted', async () => {
    const { fetcher } = createFetcher((url) => {
      if (upstreamTarget(url) === NEXT_EPISODE_URL) {
        return { text: mediaPlaylist(6, `${CDN}ep2/`) };
      }
      if (url.startsWith(`${CDN}ep2/seg-`)) return { bytes: 1_000 };
      return null;
    });
    let pending: ReturnType<typeof run> | null = null;
    const abortingFetcher: PreloadFetcher = async (url, init) => {
      if (url.endsWith('seg-1.ts')) pending?.controller.abort();
      return fetcher(url, init);
    };

    pending = run(abortingFetcher);

    await expect(pending.result).resolves.toBe(1);
    expect(pending.cache.has(`${CDN}ep2/seg-0.ts`)).toBe(true);
    expect(pending.cache.has(`${CDN}ep2/seg-1.ts`)).toBe(false);
  });
});

describe('scheduleNextEpisodePreload', () => {
  const originalFetch = global.fetch;
  let fetchSignals: AbortSignal[];

  function createVideo(overrides: Record<string, unknown> = {}) {
    return {
      currentTime: 100,
      duration: 1_500,
      buffered: createRanges([[0, 1_500]]),
      hls: {
        config: { fLoader: FragmentMemoryCacheLoader },
        levels: [{ bitrate: 2_000_000, maxBitrate: 2_000_000 }],
        loadLevel: 0,
        currentLevel: 0,
      },
      ...overrides,
    } as unknown as HTMLVideoElement & { currentTime: number };
  }

  function createOptions(
    video: HTMLVideoElement | null,
    overrides: Partial<NextEpisodePreloadOptions> = {},
  ): NextEpisodePreloadOptions {
    return {
      sourceKey: 'giri',
      videoId: '42',
      episodeIndex: 0,
      nextEpisodeUrl: NEXT_EPISODE_URL,
      getVideo: () => video,
      detailRef: { current: { source: 'giri', id: '42' } },
      currentEpisodeIndexRef: { current: 0 },
      autoPlayNextEnabledRef: { current: true },
      blockAdEnabledRef: { current: false },
      skipConfigRef: {
        current: { enable: false, intro_time: 0, outro_time: 0 },
      },
      ...overrides,
    };
  }

  async function tick() {
    jest.advanceTimersByTime(NEXT_EPISODE_PRELOAD_LIMITS.checkIntervalMs);
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    jest.useFakeTimers();
    window.history.pushState({}, '', '/play');
    fetchSignals = [];
    global.fetch = jest.fn((_url: RequestInfo, init?: RequestInit) => {
      if (init?.signal) fetchSignals.push(init.signal);
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
  });

  afterEach(() => {
    cancelNextEpisodePreload();
    jest.useRealTimers();
    global.fetch = originalFetch;
    window.history.pushState({}, '', '/');
  });

  it('waits for the last minute and preloads only once per episode', async () => {
    const video = createVideo();
    const options = createOptions(video);
    scheduleNextEpisodePreload(options);

    await tick();
    expect(global.fetch).not.toHaveBeenCalled();

    video.currentTime = 1_450;
    await tick();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    scheduleNextEpisodePreload(createOptions(video));
    await tick();
    await tick();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('起播且缓冲稳定后预热下一集一次，片尾预载照常', async () => {
    const warmUp = jest.fn();
    const video = createVideo({
      currentTime: 0,
      buffered: createRanges([[0, 5]]),
    });
    scheduleNextEpisodePreload(createOptions(video, { warmUp }));

    await tick();
    expect(warmUp).not.toHaveBeenCalled();

    video.currentTime = 2;
    (video as unknown as { buffered: unknown }).buffered = createRanges([
      [0, 1_500],
    ]);
    await tick();
    expect(warmUp).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();

    scheduleNextEpisodePreload(createOptions(video, { warmUp }));
    video.currentTime = 1_450;
    await tick();
    expect(warmUp).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('关闭连播时不预热下一集', async () => {
    const warmUp = jest.fn();
    const video = createVideo();
    scheduleNextEpisodePreload(
      createOptions(video, {
        warmUp,
        autoPlayNextEnabledRef: { current: false },
      }),
    );
    await tick();
    await tick();
    expect(warmUp).not.toHaveBeenCalled();
  });

  it('aborts the running preload when the episode changes', async () => {
    const video = createVideo({ currentTime: 1_450 });
    scheduleNextEpisodePreload(createOptions(video));
    await tick();
    expect(fetchSignals).toHaveLength(1);
    expect(fetchSignals[0].aborted).toBe(false);

    scheduleNextEpisodePreload(
      createOptions(video, {
        episodeIndex: 1,
        nextEpisodeUrl: `${CDN}ep3/index.m3u8`,
        currentEpisodeIndexRef: { current: 1 },
      }),
    );
    expect(fetchSignals[0].aborted).toBe(true);
  });

  it('does not preload when the memory loader is not installed', async () => {
    const video = createVideo({
      currentTime: 1_450,
      hls: { config: {}, levels: [], loadLevel: -1, currentLevel: -1 },
    });
    scheduleNextEpisodePreload(createOptions(video));
    await tick();
    await tick();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('stops watching once the player leaves the episode', async () => {
    const video = createVideo();
    const currentEpisodeIndexRef = { current: 0 };
    scheduleNextEpisodePreload(
      createOptions(video, { currentEpisodeIndexRef }),
    );

    currentEpisodeIndexRef.current = 1;
    await tick();
    currentEpisodeIndexRef.current = 0;
    video.currentTime = 1_450;
    await tick();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
