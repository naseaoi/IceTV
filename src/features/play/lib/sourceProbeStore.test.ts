import {
  SOURCE_PROBE_STARTUP_HOLD_MS,
  SourceProbeDeferredError,
} from '@/features/play/lib/sourceProbeRequestPolicy';
import {
  getFreshProbeInfo,
  getOrProbe,
  getSnapshot,
  holdBackgroundSourceProbes,
  releaseBackgroundSourceProbes,
  resetProbes,
  resolveRequestedProbeEpisodeUrl,
  seedProbeResults,
  writePlayerInfo,
} from '@/features/play/lib/sourceProbeStore';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import { getSourcePlaybackRoute } from '@/lib/proxy-modes';
import { reportSourcePlayOutcome } from '@/lib/source-route-stats.client';
import type { SearchResult } from '@/lib/types';

jest.mock('@/features/play/lib/vodProbe', () => ({
  probeVodEpisodeUrl: jest.fn(),
}));

jest.mock('@/lib/proxy-modes', () => ({
  getProxyModes: jest.fn(() => Promise.resolve({})),
  getSourcePlaybackRoute: jest.fn(() => ({
    useServerProxy: false,
    directManifest: false,
    allowAutoFallback: true,
  })),
}));

jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourcePlayOutcome: jest.fn(),
  reportSourceRouteStat: jest.fn(),
}));

function createSearchResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: '1',
    title: 'test',
    poster: '',
    episodes: [],
    episodes_titles: [],
    source: 'source-a',
    source_name: 'Source A',
    year: '2026',
    ...partial,
  };
}

describe('sourceProbeStore helpers', () => {
  beforeEach(() => {
    releaseBackgroundSourceProbes();
    resetProbes();
    jest.clearAllMocks();
    (
      getSourcePlaybackRoute as jest.MockedFunction<
        typeof getSourcePlaybackRoute
      >
    ).mockReturnValue({
      useServerProxy: false,
      directManifest: false,
      allowAutoFallback: true,
    });
  });

  it('暂缓期间后台与面板排队，放行后共享两个执行槽', async () => {
    const info = { quality: '1080p', loadSpeed: '1 MB/s', pingTime: 20 };
    const backgroundProbe = jest.fn().mockResolvedValue(info);
    jest.mocked(probeVodEpisodeUrl).mockResolvedValue(info);
    holdBackgroundSourceProbes();
    const background = getOrProbe(createSearchResult({ id: 'background' }), {
      probe: backgroundProbe,
      probeIdentity: 'ep2',
    });
    const panel = getOrProbe(createSearchResult({ episodes: ['ep1'] }));
    await Promise.resolve();
    expect(backgroundProbe).not.toHaveBeenCalled();
    expect(probeVodEpisodeUrl).not.toHaveBeenCalled();
    expect([...getSnapshot().values()].map((entry) => entry.source)).toEqual([
      'queued',
      'queued',
    ]);
    releaseBackgroundSourceProbes();
    await Promise.all([background, panel]);
    expect(backgroundProbe).toHaveBeenCalledTimes(1);
    expect(probeVodEpisodeUrl).toHaveBeenCalledTimes(1);
  });

  it('失败放行后同步开始下一源，已获槽位的后台任务重新排队', async () => {
    const probe = jest.fn().mockResolvedValue({
      quality: '1080p',
      loadSpeed: '1 MB/s',
      pingTime: 20,
    });
    holdBackgroundSourceProbes();
    const task = getOrProbe(createSearchResult({}), { probe });
    releaseBackgroundSourceProbes();
    holdBackgroundSourceProbes();
    await Promise.resolve();
    expect(probe).not.toHaveBeenCalled();
    expect(getSnapshot().get('source-a-1')?.source).toBe('queued');
    releaseBackgroundSourceProbes();
    await task;
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('暂缓上限到达自动放行', async () => {
    jest.useFakeTimers();
    try {
      const probe = jest.fn().mockResolvedValue({
        quality: '1080p',
        loadSpeed: '1 MB/s',
        pingTime: 20,
      });
      holdBackgroundSourceProbes();
      const task = getOrProbe(createSearchResult({}), { probe });
      jest.advanceTimersByTime(SOURCE_PROBE_STARTUP_HOLD_MS - 1);
      await Promise.resolve();
      expect(probe).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await task;
      expect(probe).toHaveBeenCalledTimes(1);
    } finally {
      releaseBackgroundSourceProbes();
      jest.useRealTimers();
    }
  });

  it('force 提升已排队任务且前台与面板合并时不重复取样', async () => {
    const info = { quality: '1080p', loadSpeed: '1 MB/s', pingTime: 20 };
    let finish!: (value: typeof info) => void;
    const probe = jest.fn(
      () =>
        new Promise<typeof info>((resolve) => {
          finish = resolve;
        }),
    );
    const source = createSearchResult({ episodes: ['ep1', 'ep2'] });
    holdBackgroundSourceProbes();
    const background = getOrProbe(source, { probe, probeIdentity: 'ep2' });
    const forcedPanel = getOrProbe(source, { force: true });
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(getSnapshot().get('source-a-1')?.source).toBe('pending');
    finish(info);
    await Promise.all([background, forcedPanel]);
    expect(probeVodEpisodeUrl).not.toHaveBeenCalled();
    releaseBackgroundSourceProbes();
  });

  it('异集初始化等待旧任务结束后独立探测，不把面板结果当作目标集证明', async () => {
    const info = { quality: '1080p', loadSpeed: '1 MB/s', pingTime: 20 };
    let finish!: (value: typeof info) => void;
    jest.mocked(probeVodEpisodeUrl).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const source = createSearchResult({ episodes: ['ep1', 'ep2'] });
    const panel = getOrProbe(source);
    const targetProbe = jest.fn().mockResolvedValue(info);
    const foreground = getOrProbe(source, {
      foreground: true,
      probeIdentity: 'ep2',
      probe: targetProbe,
    });
    for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
    expect(targetProbe).not.toHaveBeenCalled();
    finish(info);
    await Promise.all([panel, foreground]);
    expect(targetProbe).toHaveBeenCalledTimes(1);
  });

  it('预计算结果只补空位并保留最新测量与原始有效期', () => {
    const now = Date.now();
    const info = { quality: '1080p', loadSpeed: '1 MB/s', pingTime: 20 };
    seedProbeResults([['probe', info]], now);
    const snapshot = getSnapshot();
    seedProbeResults([['probe', { ...info, hasError: true }]], now + 1);
    expect(getSnapshot()).toBe(snapshot);
    expect(getFreshProbeInfo('probe', now + 10 * 60_000 - 1)).toEqual(info);
    seedProbeResults([['probe', info]], now + 10 * 60_000);
    expect(getFreshProbeInfo('probe', now + 10 * 60_000)).toBeUndefined();
    expect(getFreshProbeInfo('missing', now)).toBeUndefined();

    writePlayerInfo('player', info);
    const timestamp = getSnapshot().get('player')!.ts;
    seedProbeResults([['player', { ...info, hasError: true }]]);
    expect(getFreshProbeInfo('player', timestamp)).toEqual(info);
    expect(
      getFreshProbeInfo('player', timestamp + 10 * 60_000),
    ).toBeUndefined();
  });

  it('进行中和暂缓状态不把旧测量作为新证据', async () => {
    const info = { quality: '1080p', loadSpeed: '1 MB/s', pingTime: 20 };
    const source = createSearchResult({
      episodes: ['https://example.test/video.m3u8'],
    });
    seedProbeResults([['source-a-1', info]]);
    let rejectProbe!: (error: Error) => void;
    jest.mocked(probeVodEpisodeUrl).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectProbe = reject;
        }),
    );
    const task = getOrProbe(source, { force: true });
    expect(getSnapshot().get('source-a-1')?.source).toBe('queued');
    expect(getFreshProbeInfo('source-a-1')).toBeUndefined();
    for (let index = 0; index < 10 && !rejectProbe; index += 1) {
      await Promise.resolve();
    }
    expect(getSnapshot().get('source-a-1')?.source).toBe('pending');
    expect(getFreshProbeInfo('source-a-1')).toBeUndefined();
    seedProbeResults([['source-a-1', info]]);
    expect(getSnapshot().get('source-a-1')?.source).toBe('pending');
    rejectProbe(new SourceProbeDeferredError(2));
    await task;
    expect(getSnapshot().get('source-a-1')?.source).toBe('deferred');
    expect(getFreshProbeInfo('source-a-1')).toBeUndefined();
  });

  it('会返回指定集数对应的测速地址', () => {
    const source = createSearchResult({
      episodes: ['ep1', 'ep2', 'ep3'],
    });

    expect(resolveRequestedProbeEpisodeUrl(source, 1)).toBe('ep2');
  });

  it('待测速集不存在时返回 null', () => {
    const source = createSearchResult({
      episodes: ['ep1'],
    });

    expect(resolveRequestedProbeEpisodeUrl(source, null)).toBeNull();
    expect(resolveRequestedProbeEpisodeUrl(source, 3)).toBeNull();
  });

  it('同时最多执行 2 个测速任务', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;
    const releases: Array<() => void> = [];
    const probeMock = probeVodEpisodeUrl as jest.MockedFunction<
      typeof probeVodEpisodeUrl
    >;

    probeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          activeCount += 1;
          maxActiveCount = Math.max(maxActiveCount, activeCount);
          releases.push(() => {
            activeCount -= 1;
            resolve({
              quality: '1080p',
              loadSpeed: '1 MB/s',
              pingTime: 20,
            });
          });
        }),
    );

    const sources = Array.from({ length: 6 }, (_, index) =>
      createSearchResult({
        id: `${index}`,
        source: `source-${index}`,
        episodes: [`https://example.test/${index}.m3u8`],
      }),
    );
    const tasks = sources.map((source, index) =>
      getOrProbe(
        source,
        index < 2
          ? {
              foreground: true,
              probeIdentity: source.episodes[0],
              probe: () =>
                probeMock(
                  source.episodes[0],
                  {
                    useServerProxy: false,
                    directManifest: true,
                    allowAutoFallback: false,
                  },
                  source.source,
                ),
            }
          : { force: true },
      ),
    );

    for (let index = 0; index < 10 && releases.length < 2; index += 1) {
      await Promise.resolve();
    }

    expect(releases).toHaveLength(2);
    expect(maxActiveCount).toBe(2);
    expect(
      Array.from(getSnapshot().values()).filter(
        (entry) => entry.source === 'pending',
      ),
    ).toHaveLength(2);
    expect(
      Array.from(getSnapshot().values()).filter(
        (entry) => entry.source === 'queued',
      ),
    ).toHaveLength(4);

    for (let batch = 0; batch < 3; batch += 1) {
      releases.splice(0).forEach((release) => release());
      for (let index = 0; index < 20 && releases.length < 2; index += 1) {
        await Promise.resolve();
      }
    }

    expect(maxActiveCount).toBe(2);
    await Promise.all(tasks);
    expect(probeMock).toHaveBeenCalledTimes(6);
    expect(reportSourcePlayOutcome).toHaveBeenCalledTimes(4);
    expect(reportSourcePlayOutcome).toHaveBeenCalledWith('source-2', true);
  });

  it('繁忙时保留暂缓状态且不污染源站失败统计', async () => {
    const probeMock = probeVodEpisodeUrl as jest.Mock;
    probeMock.mockRejectedValue(new SourceProbeDeferredError(2));
    const source = createSearchResult({
      episodes: ['https://example.test/video.m3u8'],
    });
    await getOrProbe(source, { force: true });
    expect(getSnapshot().get('source-a-1')).toMatchObject({
      source: 'deferred',
    });
    expect(getSnapshot().get('source-a-1')?.info.hasError).toBeUndefined();
    expect(reportSourcePlayOutcome).not.toHaveBeenCalled();
    await getOrProbe(source, { force: true });
    expect(probeMock).toHaveBeenCalledTimes(1);
  });

  it('把检测失败写入源健康统计', async () => {
    const probeMock = probeVodEpisodeUrl as jest.MockedFunction<
      typeof probeVodEpisodeUrl
    >;
    probeMock.mockRejectedValue(new Error('probe failed'));

    await getOrProbe(
      createSearchResult({
        source: 'source-failed',
        episodes: ['https://example.test/failed.m3u8'],
      }),
      { force: true },
    );

    expect(reportSourcePlayOutcome).toHaveBeenCalledWith(
      'source-failed',
      false,
    );
  });

  it('无可检测剧集时也写入失败结果', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as typeof fetch;

    try {
      await getOrProbe(
        createSearchResult({
          source: 'source-empty',
          episodes: [],
        }),
        { force: true },
      );
    } finally {
      global.fetch = originalFetch;
    }

    expect(reportSourcePlayOutcome).toHaveBeenCalledWith('source-empty', false);
  });

  it('代理检测成功写入源健康结果', async () => {
    const probeMock = probeVodEpisodeUrl as jest.MockedFunction<
      typeof probeVodEpisodeUrl
    >;
    probeMock.mockResolvedValue({
      quality: '1080p',
      loadSpeed: '1 MB/s',
      pingTime: 20,
    });
    (
      getSourcePlaybackRoute as jest.MockedFunction<
        typeof getSourcePlaybackRoute
      >
    ).mockReturnValue({
      useServerProxy: true,
      directManifest: false,
      allowAutoFallback: false,
    });

    await getOrProbe(
      createSearchResult({
        source: 'source-server',
        episodes: ['https://example.test/server.m3u8'],
      }),
      { force: true },
    );

    expect(reportSourcePlayOutcome).toHaveBeenCalledWith('source-server', true);
  });
});

test('共享探测只在最后消费者离开时中止，取消不记源失败', async () => {
  resetProbes();
  releaseBackgroundSourceProbes();
  jest.clearAllMocks();
  const first = new AbortController();
  const second = new AbortController();
  let signal!: AbortSignal;
  const probe = jest.fn((sharedSignal: AbortSignal) => {
    signal = sharedSignal;
    return new Promise<never>((_, reject) =>
      signal.addEventListener('abort', () =>
        reject(new DOMException('cancel', 'AbortError')),
      ),
    );
  });
  const source = createSearchResult({
    source: 'shared-cancel',
    episodes: ['https://cdn.test/1.m3u8'],
  });
  const a = getOrProbe(source, { signal: first.signal, probe });
  const b = getOrProbe(source, { signal: second.signal });
  await Promise.resolve();
  first.abort();
  await a;
  expect(signal.aborted).toBe(false);
  second.abort();
  await b;
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(reportSourcePlayOutcome).not.toHaveBeenCalled();
  expect(getSnapshot().has('shared-cancel-1')).toBe(false);
});

test('排队探测取消后不占执行槽、不发请求', async () => {
  resetProbes();
  holdBackgroundSourceProbes();
  const controller = new AbortController();
  const probe = jest.fn();
  const task = getOrProbe(createSearchResult({ source: 'queued-cancel' }), {
    signal: controller.signal,
    probe,
  });
  controller.abort();
  await task;
  releaseBackgroundSourceProbes();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(probe).not.toHaveBeenCalled();
  expect(getSnapshot().has('queued-cancel-1')).toBe(false);
});
