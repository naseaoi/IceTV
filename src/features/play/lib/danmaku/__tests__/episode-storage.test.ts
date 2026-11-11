import {
  fetchDanmakuComments,
  rankCandidatesByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import {
  carryOverDanmakuEpisodeMapping,
  clearPersistedEpisodeId,
  getPersistedEpisodeId,
  persistEpisodeId,
} from '@/features/play/lib/danmaku/episode-storage';
import { loadDanmakuForEpisode } from '@/features/play/lib/danmaku/resolve';
import {
  readDanmakuEpisodeId,
  readDanmakuEpisodeSearchTitle,
  writeDanmakuEpisodeId,
  writeDanmakuEpisodeSearchTitle,
} from '@/lib/local-preferences';

jest.mock('@/features/play/lib/danmaku/client', () => ({
  fetchDanmakuComments: jest.fn(),
  rankCandidatesByEpisode: jest.fn(),
  searchDanmakuCandidates: jest.fn(),
}));

const previousScope = { source: 'a', videoId: 'a-id', episodeIndex: 2 };
const nextScope = { source: 'b', videoId: 'b-id', episodeIndex: 2 };

describe('carryOverDanmakuEpisodeMapping', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.resetAllMocks();
    window.localStorage.clear();
    global.fetch = jest.fn(async () => ({ ok: false }) as Response);
    (searchDanmakuCandidates as jest.Mock).mockResolvedValue([]);
    (rankCandidatesByEpisode as jest.Mock).mockReturnValue([]);
    (fetchDanmakuComments as jest.Mock).mockResolvedValue([
      { text: '弹幕', time: 1, mode: 0, color: '#fff' },
    ]);
  });

  it('新源沿用换源前的弹幕剧集，按原关键词直接拉取评论而不按新源标题重搜', async () => {
    writeDanmakuEpisodeId('a:a-id:2', 4242);
    writeDanmakuEpisodeSearchTitle('a:a-id:2', '测试剧');

    expect(carryOverDanmakuEpisodeMapping([previousScope], nextScope)).toBe(
      true,
    );
    const items = await loadDanmakuForEpisode(
      { ...nextScope, searchTitle: '测试剧 国语版', searchYear: '2024' },
      () => true,
    );

    expect(items).toHaveLength(1);
    expect(fetchDanmakuComments).toHaveBeenCalledWith(4242, undefined, {
      force: undefined,
      keyword: '测试剧',
    });
    expect(searchDanmakuCandidates).not.toHaveBeenCalled();
  });

  it('依次尝试来源作用域，目标已有映射或来源都没有映射时不写入', () => {
    writeDanmakuEpisodeId('anchor:anchor-id:1', 99);
    const anchorScope = {
      source: 'anchor',
      videoId: 'anchor-id',
      episodeIndex: 1,
    };

    expect(
      carryOverDanmakuEpisodeMapping([previousScope], {
        ...nextScope,
        source: 'c',
      }),
    ).toBe(false);
    expect(readDanmakuEpisodeId('c:b-id:2')).toBeNull();

    expect(
      carryOverDanmakuEpisodeMapping([previousScope, anchorScope], nextScope),
    ).toBe(true);
    expect(readDanmakuEpisodeId('b:b-id:2')).toBe(99);
    expect(readDanmakuEpisodeSearchTitle('b:b-id:2')).toBe('');

    writeDanmakuEpisodeId('a:a-id:2', 4242);
    expect(carryOverDanmakuEpisodeMapping([previousScope], nextScope)).toBe(
      false,
    );
    expect(readDanmakuEpisodeId('b:b-id:2')).toBe(99);
  });
});

it.each([false, true])(
  '绑定和清除成功=%s 时只在服务端确认后修改本地值',
  async (ok) => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok });
    try {
      writeDanmakuEpisodeId('a:a-id:2', 42);
      expect(await persistEpisodeId('a', 'a-id', 2, 99)).toBe(ok);
      expect(readDanmakuEpisodeId('a:a-id:2')).toBe(ok ? 99 : 42);
      expect(await clearPersistedEpisodeId('a', 'a-id', 2)).toBe(ok);
      expect(readDanmakuEpisodeId('a:a-id:2')).toBe(ok ? null : 42);
    } finally {
      global.fetch = previousFetch;
    }
  },
);

describe('映射在途与明确空值缓存', () => {
  const previousFetch = global.fetch;
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie =
      'auth_meta=' +
      encodeURIComponent(JSON.stringify({ username: 'mapping-a' }));
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = previousFetch;
    jest.restoreAllMocks();
    document.cookie = 'auth_meta=;max-age=0';
  });

  it('相同账号和 scope 合并在途，空值在 30 秒内复用且到期重读', async () => {
    let finish!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = getPersistedEpisodeId('cache', 'merge', 0);
    const second = getPersistedEpisodeId('cache', 'merge', 0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    finish({ ok: true, json: async () => ({ episodeId: null }) });
    await Promise.all([first, second]);
    await getPersistedEpisodeId('cache', 'merge', 0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 30_001);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ episodeId: 123 }),
    });
    expect(await getPersistedEpisodeId('cache', 'merge', 0)).toBe(123);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('失败不负缓存，账号切换不复用空值', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true, json: async () => ({ episodeId: null }) });
    await getPersistedEpisodeId('cache', 'failure', 0);
    await getPersistedEpisodeId('cache', 'failure', 0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    document.cookie =
      'auth_meta=' +
      encodeURIComponent(JSON.stringify({ username: 'mapping-b' }));
    await getPersistedEpisodeId('cache', 'failure', 0);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('PUT 和 DELETE 使空缓存失效，迟到读取不覆盖新绑定', async () => {
    let finish!: (value: unknown) => void;
    (global.fetch as jest.Mock)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue({ ok: true, json: async () => ({ episodeId: null }) });
    const pending = getPersistedEpisodeId('cache', 'mutation', 0);
    expect(await persistEpisodeId('cache', 'mutation', 0, 456)).toBe(true);
    finish({ ok: true, json: async () => ({ episodeId: 999 }) });
    expect(await pending).toBe(456);
    expect(readDanmakuEpisodeId('cache:mutation:0')).toBe(456);
    await clearPersistedEpisodeId('cache', 'mutation', 0);
    await getPersistedEpisodeId('cache', 'mutation', 0);
    await clearPersistedEpisodeId('cache', 'mutation', 0);
    await getPersistedEpisodeId('cache', 'mutation', 0);
    expect(global.fetch).toHaveBeenCalledTimes(6);
  });

  it('carry-over 作废在途旧映射并优先返回本地继承值', async () => {
    let finish!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = getPersistedEpisodeId('cache', 'carry', 0);
    writeDanmakuEpisodeId('origin:video:0', 789);
    expect(
      carryOverDanmakuEpisodeMapping(
        [{ source: 'origin', videoId: 'video', episodeIndex: 0 }],
        { source: 'cache', videoId: 'carry', episodeIndex: 0 },
      ),
    ).toBe(true);
    finish({ ok: true, json: async () => ({ episodeId: null }) });
    expect(await pending).toBe(789);
    expect(await getPersistedEpisodeId('cache', 'carry', 0)).toBe(789);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
