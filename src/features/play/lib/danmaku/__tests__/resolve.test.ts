import {
  fetchDanmakuComments,
  rankCandidatesByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import {
  clearPersistedEpisodeId,
  getPersistedEpisodeId,
} from '@/features/play/lib/danmaku/episode-storage';
import { loadDanmakuForEpisode } from '@/features/play/lib/danmaku/resolve';
import { DanmakuEpisodeNotFoundError } from '@/features/play/lib/danmaku/types';
import { writeDanmakuEpisodeSearchTitle } from '@/lib/local-preferences';

jest.mock('@/features/play/lib/danmaku/client', () => ({
  fetchDanmakuComments: jest.fn(),
  rankCandidatesByEpisode: jest.fn(),
  searchDanmakuCandidates: jest.fn(),
}));

jest.mock('@/features/play/lib/danmaku/episode-storage', () => ({
  clearPersistedEpisodeId: jest.fn(),
  getPersistedEpisodeId: jest.fn(),
}));

const context = {
  source: 'source-a',
  videoId: 'video-a',
  episodeIndex: 0,
  searchTitle: '测试影片',
  searchYear: '2026',
};

describe('loadDanmakuForEpisode outcomes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    window.localStorage.clear();
    (getPersistedEpisodeId as jest.Mock).mockResolvedValue(123);
    (searchDanmakuCandidates as jest.Mock).mockResolvedValue([]);
    (rankCandidatesByEpisode as jest.Mock).mockReturnValue([]);
    (fetchDanmakuComments as jest.Mock).mockResolvedValue([]);
  });

  it('reports a comment request failure without clearing its mapping or rejecting plugin startup', async () => {
    (fetchDanmakuComments as jest.Mock).mockRejectedValue(
      new Error('network failure'),
    );
    const onError = jest.fn();
    await expect(
      loadDanmakuForEpisode(context, () => true, { onError }),
    ).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(clearPersistedEpisodeId).not.toHaveBeenCalled();
    expect(searchDanmakuCandidates).not.toHaveBeenCalled();
  });

  it('refreshes candidates as well when reloading an unbound episode', async () => {
    (getPersistedEpisodeId as jest.Mock).mockResolvedValue(null);
    await loadDanmakuForEpisode(context, () => true, { forceRefresh: true });
    expect(searchDanmakuCandidates).toHaveBeenCalledWith(
      '测试影片',
      undefined,
      { force: true },
    );
  });

  it('reports search failures as errors instead of empty success', async () => {
    (getPersistedEpisodeId as jest.Mock).mockResolvedValue(null);
    (searchDanmakuCandidates as jest.Mock).mockRejectedValue(
      new Error('search failed'),
    );
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onError = jest.fn();
    await expect(
      loadDanmakuForEpisode(context, () => true, { onError }),
    ).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });

  it('keeps no matching episodes distinct from network failures', async () => {
    (getPersistedEpisodeId as jest.Mock).mockResolvedValue(null);
    const onError = jest.fn();
    await expect(
      loadDanmakuForEpisode(context, () => true, { onError }),
    ).resolves.toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps genuinely empty comments distinct from failures', async () => {
    const onError = jest.fn();
    await expect(
      loadDanmakuForEpisode(context, () => true, { onError }),
    ).resolves.toEqual([]);
    expect(clearPersistedEpisodeId).not.toHaveBeenCalled();
    expect(searchDanmakuCandidates).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps successful comments and force-refresh behavior', async () => {
    const items = [{ text: 'test', time: 1, mode: 0, color: '#ffffff' }];
    (fetchDanmakuComments as jest.Mock).mockResolvedValue(items);
    const onError = jest.fn();
    await expect(
      loadDanmakuForEpisode(context, () => true, {
        onError,
        forceRefresh: true,
      }),
    ).resolves.toEqual(items);
    expect(fetchDanmakuComments).toHaveBeenCalledWith(123, undefined, {
      force: true,
      keyword: context.searchTitle,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not load or report failure while disabled', async () => {
    const onError = jest.fn();
    await expect(
      loadDanmakuForEpisode(context, () => false, { onError }),
    ).resolves.toEqual([]);
    expect(getPersistedEpisodeId).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('repairs an expired persisted episode with a fresh search and new comments', async () => {
    const candidate = {
      episodeId: 456,
      animeTitle: '测试影片',
      episodeTitle: '第1集',
    };
    const items = [{ text: 'test', time: 1, mode: 0, color: '#ffffff' }];
    (fetchDanmakuComments as jest.Mock)
      .mockRejectedValueOnce(new DanmakuEpisodeNotFoundError())
      .mockResolvedValueOnce(items);
    (searchDanmakuCandidates as jest.Mock).mockResolvedValue([candidate]);
    (rankCandidatesByEpisode as jest.Mock).mockReturnValue([candidate]);
    const onError = jest.fn();
    await expect(
      loadDanmakuForEpisode(context, () => true, { onError }),
    ).resolves.toEqual(items);
    expect(clearPersistedEpisodeId).toHaveBeenCalledWith(
      'source-a',
      'video-a',
      0,
    );
    expect(searchDanmakuCandidates).toHaveBeenCalledWith(
      '测试影片',
      undefined,
      { force: true },
    );
    expect(fetchDanmakuComments).toHaveBeenLastCalledWith(456, undefined, {
      force: undefined,
      keyword: context.searchTitle,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('validates manually bound titles using the saved search keyword', async () => {
    writeDanmakuEpisodeSearchTitle('source-a:video-a:0', '手动搜索标题');
    await loadDanmakuForEpisode(context, () => true);
    expect(fetchDanmakuComments).toHaveBeenCalledWith(123, undefined, {
      force: undefined,
      keyword: '手动搜索标题',
    });
  });
});
