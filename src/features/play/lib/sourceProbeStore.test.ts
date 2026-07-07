import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import {
  getOrProbe,
  resetProbes,
  resolveRequestedProbeEpisodeUrl,
} from '@/features/play/lib/sourceProbeStore';
import type { SearchResult } from '@/lib/types';

jest.mock('@/features/play/lib/vodProbe', () => ({
  probeVodEpisodeUrl: jest.fn(),
}));

jest.mock('@/lib/proxy-modes', () => ({
  getProxyModes: jest.fn(() => Promise.resolve({})),
  shouldUseServerProxy: jest.fn(() => false),
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

  it('同时最多执行 4 个测速任务', async () => {
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

    for (let index = 0; index < 10 && releases.length < 4; index += 1) {
      await Promise.resolve();
    }

    expect(releases).toHaveLength(4);
    expect(maxActiveCount).toBe(4);

    releases.splice(0).forEach((release) => release());

    for (let index = 0; index < 10 && releases.length < 2; index += 1) {
      await Promise.resolve();
    }

    expect(maxActiveCount).toBe(4);
    releases.splice(0).forEach((release) => release());
    await Promise.all(tasks);
    expect(probeMock).toHaveBeenCalledTimes(6);
  });
});
