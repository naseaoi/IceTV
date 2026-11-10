import {
  fetchDanmakuComments,
  rankCandidatesByEpisode,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/client';
import {
  carryOverDanmakuEpisodeMapping,
  clearPersistedEpisodeId,
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
