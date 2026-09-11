import {
  fetchDanmakuComments,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import { DanmakuEpisodeNotFoundError } from '@/features/play/lib/danmaku/types';

describe('danmaku client recovery', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('exposes explicit missing-episode errors without caching failures', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: 'DANMAKU_EPISODE_NOT_FOUND' }),
    });
    await expect(fetchDanmakuComments(830001)).rejects.toBeInstanceOf(
      DanmakuEpisodeNotFoundError,
    );
    await expect(fetchDanmakuComments(830001)).rejects.toBeInstanceOf(
      DanmakuEpisodeNotFoundError,
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not classify an arbitrary 404 as an expired mapping', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    });
    await expect(fetchDanmakuComments(830002)).rejects.toThrow(
      '弹幕评论请求失败: 404',
    );
  });

  it('bypasses both search caches when replacing an expired mapping', async () => {
    const previous = {
      episodeId: 1,
      animeTitle: 'recovery-test',
      episodeTitle: '第1集',
    };
    const current = { ...previous, episodeId: 2 };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [previous] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [current] }),
      });
    await expect(searchDanmakuCandidates('recovery-test')).resolves.toEqual([
      previous,
    ]);
    await expect(
      searchDanmakuCandidates('recovery-test', undefined, { force: true }),
    ).resolves.toEqual([current]);
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/danmaku/search?keyword=recovery-test&refresh=1',
      { signal: undefined },
    );
    await expect(searchDanmakuCandidates('recovery-test')).resolves.toEqual([
      current,
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
