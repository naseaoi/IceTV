import { SourceProbeDeferredError } from '@/features/play/lib/sourceProbeRequestPolicy';
import {
  getOrProbe,
  getSnapshot,
  resetProbes,
  resolveRequestedProbeEpisodeUrl,
} from '@/features/play/lib/sourceProbeStore';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import { shouldUseServerProxy } from '@/lib/proxy-modes';
import { reportSourceRouteStat } from '@/lib/source-route-stats.client';
import type { SearchResult } from '@/lib/types';

jest.mock('@/features/play/lib/vodProbe', () => ({
  probeVodEpisodeUrl: jest.fn(),
}));

jest.mock('@/lib/proxy-modes', () => ({
  getProxyModes: jest.fn(() => Promise.resolve({})),
  shouldUseServerProxy: jest.fn(() => false),
}));

jest.mock('@/lib/source-route-stats.client', () => ({
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
    resetProbes();
    jest.clearAllMocks();
    (
      shouldUseServerProxy as jest.MockedFunction<typeof shouldUseServerProxy>
    ).mockReturnValue(false);
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
    const tasks = sources.map((source) => getOrProbe(source, { force: true }));

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
    expect(reportSourceRouteStat).toHaveBeenCalledTimes(6);
    expect(reportSourceRouteStat).toHaveBeenCalledWith(
      'source-0',
      'browser',
      true,
    );
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
    expect(reportSourceRouteStat).not.toHaveBeenCalled();
    await getOrProbe(source, { force: true });
    expect(probeMock).toHaveBeenCalledTimes(1);
  });

  it('把检测失败写入源站路由统计', async () => {
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

    expect(reportSourceRouteStat).toHaveBeenCalledWith(
      'source-failed',
      'browser',
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

    expect(reportSourceRouteStat).toHaveBeenCalledWith(
      'source-empty',
      'browser',
      false,
    );
  });

  it('按最终采用的服务端路由写入检测成功结果', async () => {
    const probeMock = probeVodEpisodeUrl as jest.MockedFunction<
      typeof probeVodEpisodeUrl
    >;
    probeMock.mockResolvedValue({
      quality: '1080p',
      loadSpeed: '1 MB/s',
      pingTime: 20,
    });
    (
      shouldUseServerProxy as jest.MockedFunction<typeof shouldUseServerProxy>
    ).mockReturnValue(true);

    await getOrProbe(
      createSearchResult({
        source: 'source-server',
        episodes: ['https://example.test/server.m3u8'],
      }),
      { force: true },
    );

    expect(reportSourceRouteStat).toHaveBeenCalledWith(
      'source-server',
      'server',
      true,
    );
  });
});
