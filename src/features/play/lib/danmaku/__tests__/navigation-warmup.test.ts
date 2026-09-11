import {
  fetchDanmakuComments,
  rankCandidatesByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import { getPersistedEpisodeId } from '@/features/play/lib/danmaku/episode-storage';
import {
  hasDanmakuNavigationWarmup,
  updateDanmakuWarmupPreference,
  warmupDanmakuData,
  warmupDanmakuForNavigation,
  warmupDanmakuSearchForNavigation,
} from '@/features/play/lib/danmaku/navigation-warmup';
import type { DanmakuLoadContext } from '@/features/play/lib/danmaku/resolve';
import { DanmakuEpisodeNotFoundError } from '@/features/play/lib/danmaku/types';

jest.mock('@/features/play/lib/danmaku/client', () => ({
  fetchDanmakuComments: jest.fn(),
  rankCandidatesByEpisode: jest.fn(),
  searchDanmakuCandidates: jest.fn(),
}));

jest.mock('@/features/play/lib/danmaku/episode-storage', () => ({
  getPersistedEpisodeId: jest.fn(),
}));

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => ({ ENABLE_DANMAKU: true }),
}));

const mockFetchComments = fetchDanmakuComments as jest.MockedFunction<
  typeof fetchDanmakuComments
>;
const mockRankCandidates = rankCandidatesByEpisode as jest.MockedFunction<
  typeof rankCandidatesByEpisode
>;
const mockSearchCandidates = searchDanmakuCandidates as jest.MockedFunction<
  typeof searchDanmakuCandidates
>;
const mockGetPersistedEpisodeId = getPersistedEpisodeId as jest.MockedFunction<
  typeof getPersistedEpisodeId
>;

function buildContext(suffix: string): DanmakuLoadContext {
  return {
    source: `source-${suffix}`,
    videoId: `video-${suffix}`,
    episodeIndex: 0,
    searchTitle: `标题-${suffix}`,
    searchYear: '2026',
  };
}

describe('danmaku navigation warmup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPersistedEpisodeId.mockResolvedValue(null);
    mockSearchCandidates.mockResolvedValue([]);
    mockRankCandidates.mockReturnValue([]);
    mockFetchComments.mockResolvedValue([]);
    updateDanmakuWarmupPreference(true);
  });

  it('已有映射时直接预取评论', async () => {
    mockGetPersistedEpisodeId.mockResolvedValue(82001);
    mockFetchComments.mockResolvedValue([
      { text: '已映射', time: 1, mode: 0, color: '#fff' },
    ]);

    await warmupDanmakuData(buildContext('mapped'));

    expect(mockFetchComments).toHaveBeenCalledWith(82001, undefined, {
      keyword: '标题-mapped',
    });
    expect(mockSearchCandidates).not.toHaveBeenCalled();
    expect(hasDanmakuNavigationWarmup('标题-mapped')).toBe(false);
  });

  it('无映射时搜索并最多尝试两个候选', async () => {
    const candidates = [
      { episodeId: 82002, animeTitle: 'A', episodeTitle: '第1集' },
      { episodeId: 82003, animeTitle: 'B', episodeTitle: '第1集' },
      { episodeId: 82004, animeTitle: 'C', episodeTitle: '第1集' },
    ];
    mockSearchCandidates.mockResolvedValue(candidates);
    mockRankCandidates.mockReturnValue(candidates);
    mockFetchComments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { text: '后备源', time: 1, mode: 0, color: '#fff' },
      ]);

    await warmupDanmakuData(buildContext('search'));

    expect(
      mockFetchComments.mock.calls.map(([episodeId]) => episodeId),
    ).toEqual([82002, 82003]);
    expect(hasDanmakuNavigationWarmup('标题-search')).toBe(true);
  });

  it('旧 ID 错绑时重新搜索而不是继续加载不相关评论', async () => {
    const candidates = [
      { episodeId: 82005, animeTitle: 'A', episodeTitle: '第1集' },
    ];
    mockGetPersistedEpisodeId.mockResolvedValue(82006);
    mockSearchCandidates.mockResolvedValue(candidates);
    mockRankCandidates.mockReturnValue(candidates);
    mockFetchComments
      .mockRejectedValueOnce(new DanmakuEpisodeNotFoundError())
      .mockResolvedValueOnce([
        { text: '正确影片', time: 1, mode: 0, color: '#fff' },
      ]);
    await warmupDanmakuData(buildContext('recycled'));
    expect(
      mockFetchComments.mock.calls.map(([episodeId]) => episodeId),
    ).toEqual([82006, 82005]);
    expect(mockFetchComments).toHaveBeenLastCalledWith(82005, undefined, {
      keyword: '标题-recycled',
    });
  });

  it('账号关闭时不触发数据请求', async () => {
    updateDanmakuWarmupPreference(false);

    await warmupDanmakuForNavigation(buildContext('disabled'));

    expect(mockGetPersistedEpisodeId).not.toHaveBeenCalled();
    expect(mockSearchCandidates).not.toHaveBeenCalled();
    expect(mockFetchComments).not.toHaveBeenCalled();
    expect(hasDanmakuNavigationWarmup('标题-disabled')).toBe(false);
  });

  it('搜索页只预热标题候选，不提前拉取评论', async () => {
    await warmupDanmakuSearchForNavigation('新搜索标题');

    expect(mockSearchCandidates).toHaveBeenCalledWith('新搜索标题');
    expect(mockFetchComments).not.toHaveBeenCalled();
    expect(hasDanmakuNavigationWarmup('新搜索标题')).toBe(true);
  });

  it('账号关闭时搜索页也不预热标题候选', async () => {
    updateDanmakuWarmupPreference(false);

    await warmupDanmakuSearchForNavigation('关闭时搜索');

    expect(mockSearchCandidates).not.toHaveBeenCalled();
    expect(hasDanmakuNavigationWarmup('关闭时搜索')).toBe(false);
  });

  it('标题搜索失败后清除预热标记以允许重试', async () => {
    mockSearchCandidates.mockRejectedValueOnce(new Error('network failed'));

    await warmupDanmakuData(buildContext('retry'));

    expect(hasDanmakuNavigationWarmup('标题-retry')).toBe(false);
  });
});
