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
import { fetchUserDanmaku } from '@/features/play/lib/danmaku/user-client';
import { writeDanmakuEpisodeSearchTitle } from '@/lib/local-preferences';

jest.mock('@/features/play/lib/danmaku/client', () => ({
  fetchDanmakuComments: jest.fn(),
  rankCandidatesByEpisode: jest.fn(),
  searchDanmakuCandidates: jest.fn(),
}));

jest.mock('@/features/play/lib/danmaku/user-client', () => ({
  fetchUserDanmaku: jest.fn(),
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

describe('loadDanmakuForEpisode with user danmaku', () => {
  const thirdParty = Array.from({ length: 10 }, (_, index) => ({
    text: `third-${index}`,
    time: index + 1,
    mode: 0 as const,
    color: '#FFFFFF',
  }));

  beforeEach(() => {
    jest.resetAllMocks();
    window.localStorage.clear();
    (getPersistedEpisodeId as jest.Mock).mockResolvedValue(123);
    (fetchDanmakuComments as jest.Mock).mockResolvedValue(thirdParty);
    (window as { RUNTIME_CONFIG?: unknown }).RUNTIME_CONFIG = {
      ENABLE_USER_DANMAKU: true,
    };
  });

  afterEach(() => {
    delete (window as { RUNTIME_CONFIG?: unknown }).RUNTIME_CONFIG;
  });

  it('targets the matched third-party episode and keeps the total within the episode limit', async () => {
    (fetchUserDanmaku as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'a',
          time: 2.5,
          text: 'mine',
          mode: 0,
          color: '#ff0000',
          mine: true,
        },
        {
          id: 'b',
          time: 7.5,
          text: 'other',
          mode: 1,
          color: '#ffffff',
          mine: false,
        },
      ],
      limit: 6,
    });
    const onUserTarget = jest.fn();

    const items = await loadDanmakuForEpisode(context, () => true, {
      onUserTarget,
    });

    expect(fetchUserDanmaku).toHaveBeenCalledWith('dandan:123');
    expect(onUserTarget).toHaveBeenCalledWith({ key: 'dandan:123', offset: 0 });
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.time)).toEqual(
      [...items.map((item) => item.time)].sort((a, b) => a - b),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ text: 'mine', border: true }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ text: 'other', border: false }),
    );
  });

  it('falls back to the source scope and still shows user danmaku without a third-party match', async () => {
    (getPersistedEpisodeId as jest.Mock).mockResolvedValue(null);
    (searchDanmakuCandidates as jest.Mock).mockResolvedValue([]);
    (rankCandidatesByEpisode as jest.Mock).mockReturnValue([]);
    (fetchUserDanmaku as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'a',
          time: 3,
          text: 'hello',
          mode: 0,
          color: '#ffffff',
          mine: false,
        },
      ],
      limit: 3000,
    });

    const items = await loadDanmakuForEpisode(context, () => true);

    expect(fetchUserDanmaku).toHaveBeenCalledWith('src:source-a:video-a:0');
    expect(items).toEqual([
      expect.objectContaining({ text: 'hello', time: 3 }),
    ]);
  });

  it('keeps the persisted episode as the target when third-party comments fail', async () => {
    (fetchDanmakuComments as jest.Mock).mockRejectedValue(new Error('down'));
    (fetchUserDanmaku as jest.Mock).mockResolvedValue({
      items: [],
      limit: 3000,
    });
    const onUserTarget = jest.fn();

    await loadDanmakuForEpisode(context, () => true, { onUserTarget });

    expect(onUserTarget).toHaveBeenCalledWith({ key: 'dandan:123', offset: 0 });
  });

  it('returns third-party danmaku when user danmaku fails to load', async () => {
    (fetchUserDanmaku as jest.Mock).mockRejectedValue(new Error('500'));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      loadDanmakuForEpisode(context, () => true),
    ).resolves.toHaveLength(thirdParty.length);
    warning.mockRestore();
  });

  it('skips user danmaku when the site switch is off', async () => {
    (window as { RUNTIME_CONFIG?: unknown }).RUNTIME_CONFIG = {
      ENABLE_USER_DANMAKU: false,
    };
    const onUserTarget = jest.fn();

    await loadDanmakuForEpisode(context, () => true, { onUserTarget });

    expect(fetchUserDanmaku).not.toHaveBeenCalled();
    expect(onUserTarget).not.toHaveBeenCalled();
  });
});
