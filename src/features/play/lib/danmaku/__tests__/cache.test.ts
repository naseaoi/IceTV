import {
  danmakuCommentsCache,
  danmakuSearchCache,
  getCachedDanmakuComments,
} from '@/features/play/lib/danmaku/cache.server';
import {
  DANMAKU_COMMENTS_FRESH_MS,
  DANMAKU_COMMENTS_STALE_MS,
  DANMAKU_EMPTY_CACHE_MS,
} from '@/features/play/lib/danmaku/cache-policy';
import {
  fetchDanmakuByEpisodeId,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/provider.server';
import {
  type DanmakuFetchResult,
  DanmakuProviderError,
  DanmakuRateLimitError,
} from '@/features/play/lib/danmaku/types';

jest.mock('server-only', () => ({}));
jest.mock('@/features/play/lib/danmaku/provider.server', () => ({
  fetchDanmakuByEpisodeId: jest.fn(),
  searchDanmakuCandidates: jest.fn(),
}));

const fetchComments = fetchDanmakuByEpisodeId as jest.Mock;
const searchCandidates = searchDanmakuCandidates as jest.Mock;
const empty: DanmakuFetchResult = { items: [], total: 0, truncated: false };
const populated: DanmakuFetchResult = {
  items: [{ text: '弹幕', time: 1, mode: 0, color: '#fff' }],
  total: 1,
  truncated: false,
};

describe('danmaku comment cache recovery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    fetchComments.mockReset();
    searchCandidates.mockReset();
    danmakuCommentsCache.clear();
    danmakuSearchCache.clear();
  });

  afterEach(() => {
    danmakuCommentsCache.clear();
    jest.useRealTimers();
  });

  it('expires empty results without serving them stale', async () => {
    fetchComments.mockResolvedValueOnce(empty).mockResolvedValueOnce(populated);
    await expect(getCachedDanmakuComments(123, 1000)).resolves.toEqual(empty);
    jest.advanceTimersByTime(DANMAKU_EMPTY_CACHE_MS - 1);
    await expect(getCachedDanmakuComments(123, 1000)).resolves.toEqual(empty);
    expect(fetchComments).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await expect(getCachedDanmakuComments(123, 1000)).resolves.toEqual(
      populated,
    );
    expect(fetchComments).toHaveBeenCalledTimes(2);
  });

  it('rejects a recycled ID before fetching unrelated comments', async () => {
    searchCandidates.mockResolvedValue([
      { episodeId: 456, animeTitle: '鬼灭之刃', episodeTitle: '第1集' },
    ]);
    fetchComments.mockResolvedValue(populated);
    await getCachedDanmakuComments(123, 1000);
    fetchComments.mockClear();
    await expect(
      getCachedDanmakuComments(123, 1000, false, '鬼灭之刃'),
    ).rejects.toMatchObject({ kind: 'episode-not-found' });
    expect(fetchComments).not.toHaveBeenCalled();
    expect(searchCandidates).toHaveBeenCalledTimes(1);
  });

  it('passes the request timeout to both title validation and comment loading', async () => {
    searchCandidates.mockResolvedValue([
      { episodeId: 123, animeTitle: 'test', episodeTitle: 'Episode 1' },
    ]);
    fetchComments.mockResolvedValue(populated);

    await getCachedDanmakuComments(123, 1000, false, 'test', 4500);

    expect(searchCandidates).toHaveBeenCalledWith('test', 4500);
    expect(fetchComments).toHaveBeenCalledWith(123, 1000, 4500);
    await getCachedDanmakuComments(123, 1000, false, 'test', 8000);
    expect(searchCandidates).toHaveBeenCalledTimes(1);
    expect(fetchComments).toHaveBeenCalledTimes(1);
  });

  it('does not trust a cached positive binding when loading new comments', async () => {
    danmakuSearchCache.set('影片', [
      { episodeId: 123, animeTitle: '影片', episodeTitle: '第1集' },
    ]);
    searchCandidates.mockResolvedValue([
      { episodeId: 456, animeTitle: '影片', episodeTitle: '第1集' },
    ]);
    fetchComments.mockResolvedValue(populated);

    await expect(
      getCachedDanmakuComments(123, 1000, false, '影片'),
    ).rejects.toMatchObject({ kind: 'episode-not-found' });
    expect(fetchComments).not.toHaveBeenCalled();
  });

  it('does not revalidate a warm comment cache through an expired search cache', async () => {
    searchCandidates.mockResolvedValue([
      { episodeId: 123, animeTitle: '影片', episodeTitle: '第1集' },
    ]);
    fetchComments.mockResolvedValue(populated);
    await getCachedDanmakuComments(123, 1000, false, '影片');
    danmakuSearchCache.clear();

    await expect(
      getCachedDanmakuComments(123, 1000, false, '影片'),
    ).resolves.toEqual(populated);
    expect(searchCandidates).toHaveBeenCalledTimes(1);
    expect(fetchComments).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale title candidates before invalidating a binding', async () => {
    danmakuSearchCache.set('影片', [
      { episodeId: 456, animeTitle: '影片', episodeTitle: '第1集' },
    ]);
    searchCandidates.mockResolvedValue([
      { episodeId: 123, animeTitle: '影片', episodeTitle: '第1集' },
    ]);
    fetchComments.mockResolvedValue(populated);
    await expect(
      getCachedDanmakuComments(123, 1000, false, '影片'),
    ).resolves.toEqual(populated);
    expect(searchCandidates).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate a binding on an empty verification search', async () => {
    searchCandidates.mockResolvedValue([]);
    await expect(
      getCachedDanmakuComments(123, 1000, false, '影片'),
    ).rejects.toMatchObject({ kind: 'upstream-unavailable' });
    expect(fetchComments).not.toHaveBeenCalled();
  });

  it('isolates cached comments when the same ID belongs to another title', async () => {
    searchCandidates.mockImplementation(async (title: string) => [
      { episodeId: 123, animeTitle: title, episodeTitle: '第1集' },
    ]);
    fetchComments.mockResolvedValueOnce(populated).mockResolvedValueOnce(empty);
    await getCachedDanmakuComments(123, 1000, false, '旧影片');
    await expect(
      getCachedDanmakuComments(123, 1000, false, '新影片'),
    ).resolves.toEqual(empty);
    expect(fetchComments).toHaveBeenCalledTimes(2);
  });

  it('keeps verified comments when title verification is temporarily unavailable', async () => {
    searchCandidates
      .mockResolvedValueOnce([
        { episodeId: 123, animeTitle: '影片', episodeTitle: '第1集' },
      ])
      .mockRejectedValueOnce(
        new DanmakuProviderError('upstream-unavailable', 'unavailable'),
      );
    fetchComments.mockResolvedValue(populated);
    await getCachedDanmakuComments(123, 1000, false, '影片');
    await expect(
      getCachedDanmakuComments(123, 1000, true, '影片'),
    ).resolves.toEqual(populated);
    expect(fetchComments).toHaveBeenCalledTimes(1);
  });

  it('keeps nonempty results fresh for the normal lifetime', async () => {
    fetchComments.mockResolvedValue(populated);
    await getCachedDanmakuComments(123, 1000);
    jest.advanceTimersByTime(DANMAKU_EMPTY_CACHE_MS + 1);
    await expect(getCachedDanmakuComments(123, 1000)).resolves.toEqual(
      populated,
    );
    expect(fetchComments).toHaveBeenCalledTimes(1);
  });

  it('does not retain empty candidate searches for half an hour', async () => {
    const candidates = [
      { episodeId: 123, animeTitle: '番剧', episodeTitle: '第1集' },
    ];
    const loadSearch = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(candidates);
    await expect(
      danmakuSearchCache.getOrLoad('番剧', loadSearch),
    ).resolves.toEqual([]);
    jest.advanceTimersByTime(DANMAKU_EMPTY_CACHE_MS);
    await expect(
      danmakuSearchCache.getOrLoad('番剧', loadSearch),
    ).resolves.toEqual(candidates);
    expect(loadSearch).toHaveBeenCalledTimes(2);
  });

  it('explicit refresh bypasses an empty cache immediately', async () => {
    fetchComments.mockResolvedValueOnce(empty).mockResolvedValueOnce(populated);
    await getCachedDanmakuComments(123, 1000);
    await expect(getCachedDanmakuComments(123, 1000, true)).resolves.toEqual(
      populated,
    );
    expect(fetchComments).toHaveBeenCalledTimes(2);
  });

  it('does not replace known comments or extend their lifetime with an empty refresh', async () => {
    fetchComments.mockResolvedValueOnce(populated).mockResolvedValueOnce(empty);
    await getCachedDanmakuComments(123, 1000);
    jest.advanceTimersByTime(1000);
    await expect(getCachedDanmakuComments(123, 1000, true)).resolves.toEqual(
      populated,
    );
    expect(danmakuCommentsCache.peek('123:1000')?.value).toEqual(populated);
    jest.setSystemTime(DANMAKU_COMMENTS_FRESH_MS + DANMAKU_COMMENTS_STALE_MS);
    expect(danmakuCommentsCache.peek('123:1000')).toBeNull();
  });

  it.each([
    new DanmakuProviderError('upstream-unavailable', 'network failed'),
    new DanmakuRateLimitError(60),
    new DanmakuProviderError('invalid-response', 'invalid payload'),
  ])('retains usable comments when refreshing fails: %s', async (error) => {
    fetchComments.mockResolvedValueOnce(populated).mockRejectedValueOnce(error);
    await getCachedDanmakuComments(123, 1000);
    await expect(getCachedDanmakuComments(123, 1000, true)).resolves.toEqual(
      populated,
    );
    expect(danmakuCommentsCache.peek('123:1000')?.value).toEqual(populated);
  });

  it('does not hide an expired episode mapping behind old comments', async () => {
    const missing = new DanmakuProviderError('episode-not-found', 'expired');
    fetchComments
      .mockResolvedValueOnce(populated)
      .mockRejectedValueOnce(missing);
    await getCachedDanmakuComments(123, 1000);
    await expect(getCachedDanmakuComments(123, 1000, true)).rejects.toBe(
      missing,
    );
    expect(danmakuCommentsCache.peek('123:1000')).toBeNull();
  });

  it('propagates failures when only an empty result was cached', async () => {
    const limited = new DanmakuRateLimitError(60);
    fetchComments.mockResolvedValueOnce(empty).mockRejectedValueOnce(limited);
    await getCachedDanmakuComments(123, 1000);
    await expect(getCachedDanmakuComments(123, 1000, true)).rejects.toBe(
      limited,
    );
  });

  it('deduplicates concurrent explicit refreshes', async () => {
    let finish!: (result: DanmakuFetchResult) => void;
    fetchComments.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = getCachedDanmakuComments(123, 1000, true);
    const second = getCachedDanmakuComments(123, 1000, true);
    expect(fetchComments).toHaveBeenCalledTimes(1);
    finish(populated);
    await expect(Promise.all([first, second])).resolves.toEqual([
      populated,
      populated,
    ]);
  });
});
