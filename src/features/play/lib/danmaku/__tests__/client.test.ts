import {
  extractEpisodeNumber,
  fetchDanmakuComments,
  groupCandidatesBySource,
  pickCandidateByEpisode,
  rankCandidatesByEpisode,
  searchDanmakuCandidates,
  splitSourceProvider,
  warmupDanmakuSearch,
} from '@/features/play/lib/danmaku/client';
import type { DanmakuMatchCandidate } from '@/features/play/lib/danmaku/types';

// 标题样本取自本地 danmu_api 实测响应
describe('extractEpisodeNumber', () => {
  it('优先匹配「第N集」', () => {
    expect(extractEpisodeNumber('【youku】 第1集 凡人修仙传 01')).toBe(1);
    expect(extractEpisodeNumber('【youku】 第30集 凡人修仙传 30')).toBe(30);
  });

  it('支持「第N话」与「第N期」', () => {
    expect(extractEpisodeNumber('【bilibili1】 第22话 魔道争锋1')).toBe(22);
    expect(extractEpisodeNumber('【mgtv】 第5期 综艺')).toBe(5);
  });

  it('不把来源标签里的数字当集号', () => {
    expect(extractEpisodeNumber('【bilibili1】 第22话 魔道争锋1')).not.toBe(1);
    expect(extractEpisodeNumber('【bilibili1】 第1集')).toBe(1);
  });

  it('没有序数词时回落到剔除标签后的首个数字', () => {
    expect(extractEpisodeNumber('【bilibili1】 EP07 标题')).toBe(7);
  });

  it('完全无数字时返回 null', () => {
    expect(extractEpisodeNumber('【youku】 正片')).toBeNull();
  });

  it('容忍序数词内的空格', () => {
    expect(extractEpisodeNumber('第 12 集')).toBe(12);
  });
});

describe('pickCandidateByEpisode', () => {
  const build = (titles: string[]): DanmakuMatchCandidate[] =>
    titles.map((episodeTitle, i) => ({
      episodeId: 1000 + i,
      animeTitle: '凡人修仙传',
      episodeTitle,
    }));

  it('按集号命中而非按顺序', () => {
    const candidates = build([
      '【youku】 第3集 凡人修仙传 03',
      '【youku】 第1集 凡人修仙传 01',
      '【youku】 第2集 凡人修仙传 02',
    ]);
    expect(pickCandidateByEpisode(candidates, 0)?.episodeTitle).toBe(
      '【youku】 第1集 凡人修仙传 01',
    );
    expect(pickCandidateByEpisode(candidates, 1)?.episodeTitle).toBe(
      '【youku】 第2集 凡人修仙传 02',
    );
  });

  it('集号缺失时按索引回落', () => {
    const candidates = build(['【youku】 正片', '【youku】 花絮']);
    expect(pickCandidateByEpisode(candidates, 1)?.episodeTitle).toBe(
      '【youku】 花絮',
    );
  });

  it('集号存在但目标集缺失时不按位置误绑', () => {
    const candidates = build(['【youku】 第1集', '【youku】 第3集']);
    expect(pickCandidateByEpisode(candidates, 1)).toBeNull();
  });

  it('候选为空返回 null', () => {
    expect(pickCandidateByEpisode([], 0)).toBeNull();
  });

  it('索引越界返回 null', () => {
    expect(pickCandidateByEpisode(build(['【youku】 正片']), 5)).toBeNull();
  });

  it('不受来源标签数字干扰', () => {
    const candidates = build([
      '【bilibili1】 第22话 魔道争锋1',
      '【bilibili1】 第23话 魔道争锋2',
    ]);
    expect(pickCandidateByEpisode(candidates, 21)?.episodeTitle).toBe(
      '【bilibili1】 第22话 魔道争锋1',
    );
  });

  it('多源轮转排列时位置兜底只在首个源内数', () => {
    const candidates: DanmakuMatchCandidate[] = [
      { episodeId: 1, animeTitle: 'A', episodeTitle: '正片' },
      { episodeId: 2, animeTitle: 'B', episodeTitle: '正片' },
      { episodeId: 3, animeTitle: 'A', episodeTitle: '花絮' },
      { episodeId: 4, animeTitle: 'B', episodeTitle: '花絮' },
    ];
    expect(pickCandidateByEpisode(candidates, 1)?.episodeId).toBe(3);
  });

  it('优先按标题和年份匹配系列，避免误选其他季度', () => {
    const candidates: DanmakuMatchCandidate[] = [
      {
        episodeId: 10,
        animeTitle: '鬼灭之刃：游郭篇(2021)【日番】from bilibili',
        episodeTitle: '【bilibili1】 第1话 音柱',
      },
      {
        episodeId: 20,
        animeTitle: '鬼灭之刃(2019)【日番】from tencent',
        episodeTitle: '【qq】 鬼灭之刃_01',
      },
    ];

    expect(
      pickCandidateByEpisode(candidates, 0, '鬼灭之刃', '2019')?.episodeId,
    ).toBe(20);
  });

  it('可返回同集的后备候选以绕过空弹幕源', () => {
    const candidates: DanmakuMatchCandidate[] = [
      { episodeId: 1, animeTitle: '测试(2026)', episodeTitle: '第1集' },
      { episodeId: 2, animeTitle: '测试(2026)', episodeTitle: '第1集' },
    ];

    expect(
      rankCandidatesByEpisode(candidates, 0, '测试', '2026').map(
        (candidate) => candidate.episodeId,
      ),
    ).toEqual([1, 2]);
  });

  it('精确标题源存在时不降级到相似电影', () => {
    const candidates: DanmakuMatchCandidate[] = [
      {
        episodeId: 10,
        animeTitle: '孤独摇滚(上)(2024)【动画电影】from migu',
        episodeTitle: '孤独摇滚（上）',
      },
      {
        episodeId: 20,
        animeTitle: '孤独摇滚！(2022)【日番】from bilibili',
        episodeTitle: '第1话 孤独的转机',
      },
      {
        episodeId: 30,
        animeTitle: '孤独摇滚！(2022)【动漫】from 360',
        episodeTitle: '第1集',
      },
    ];

    expect(
      rankCandidatesByEpisode(candidates, 0, '孤独摇滚！', '2022').map(
        (candidate) => candidate.episodeId,
      ),
    ).toEqual([20, 30]);
  });
});

describe('groupCandidatesBySource', () => {
  it('按源归并并保留组内集顺序', () => {
    const candidates: DanmakuMatchCandidate[] = [
      { episodeId: 1, animeTitle: 'youku', episodeTitle: '第1集' },
      { episodeId: 2, animeTitle: '360', episodeTitle: '第1集' },
      { episodeId: 3, animeTitle: 'youku', episodeTitle: '第2集' },
      { episodeId: 4, animeTitle: '360', episodeTitle: '第2集' },
    ];
    const groups = groupCandidatesBySource(candidates);
    expect(groups.map((group) => group.animeTitle)).toEqual(['youku', '360']);
    expect(groups[0].candidates.map((c) => c.episodeId)).toEqual([1, 3]);
    expect(groups[1].candidates.map((c) => c.episodeId)).toEqual([2, 4]);
  });

  it('保留首条候选的类型描述', () => {
    const groups = groupCandidatesBySource([
      {
        episodeId: 1,
        animeTitle: 'youku',
        episodeTitle: '第1集',
        typeDescription: '国产剧',
      },
    ]);
    expect(groups[0].typeDescription).toBe('国产剧');
  });

  it('候选为空返回空数组', () => {
    expect(groupCandidatesBySource([])).toEqual([]);
  });

  it('拆出组标题里的提供方', () => {
    const groups = groupCandidatesBySource([
      {
        episodeId: 1,
        animeTitle: '凡人修仙传(2025)【国产剧】from youku',
        episodeTitle: '第1集',
      },
    ]);
    expect(groups[0].providerLabel).toBe('youku');
    expect(groups[0].displayTitle).toBe('凡人修仙传(2025)【国产剧】');
    expect(groups[0].animeTitle).toBe('凡人修仙传(2025)【国产剧】from youku');
  });
});

describe('splitSourceProvider', () => {
  it('拆出尾部提供方', () => {
    expect(splitSourceProvider('凡人修仙传(2020)【动漫】from 360')).toEqual({
      providerLabel: '360',
      displayTitle: '凡人修仙传(2020)【动漫】',
    });
  });

  it('大小写与多空格都能拆', () => {
    expect(splitSourceProvider('标题  FROM   bilibili').providerLabel).toBe(
      'bilibili',
    );
  });

  it('无提供方后缀时原样返回', () => {
    expect(splitSourceProvider('解说版')).toEqual({
      providerLabel: null,
      displayTitle: '解说版',
    });
  });

  it('不把标题里的 from 当后缀', () => {
    expect(splitSourceProvider('from dusk till dawn').displayTitle).toBe(
      'from dusk till dawn',
    );
  });

  it('拆完标题为空时保留原标题', () => {
    expect(splitSourceProvider('from youku')).toEqual({
      providerLabel: null,
      displayTitle: 'from youku',
    });
  });
});

describe('warmupDanmakuSearch', () => {
  it('预热与随后读取复用同一个请求', async () => {
    const candidate: DanmakuMatchCandidate = {
      episodeId: 3001,
      animeTitle: '预热测试',
      episodeTitle: '第1集',
    };
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [candidate] }),
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      warmupDanmakuSearch('仅用于预热复用测试');
      await expect(
        searchDanmakuCandidates('仅用于预热复用测试'),
      ).resolves.toEqual([candidate]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      } else {
        Reflect.deleteProperty(globalThis, 'fetch');
      }
    }
  });
});

describe('fetchDanmakuComments', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  });

  it('并发预热与正式加载复用同一个请求', async () => {
    const items = [{ text: '测试弹幕', time: 1, mode: 0, color: '#fff' }];
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      Promise.all([fetchDanmakuComments(910001), fetchDanmakuComments(910001)]),
    ).resolves.toEqual([items, items]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('请求失败不污染缓存', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchDanmakuComments(910002)).rejects.toThrow(
      '弹幕评论请求失败: 502',
    );
    await expect(fetchDanmakuComments(910002)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('显式刷新绕过已有缓存', async () => {
    const firstItems = [{ text: '旧弹幕', time: 1, mode: 0, color: '#fff' }];
    const nextItems = [{ text: '新弹幕', time: 2, mode: 0, color: '#fff' }];
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: firstItems }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: nextItems }),
      } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchDanmakuComments(910003)).resolves.toEqual(firstItems);
    await expect(fetchDanmakuComments(910003)).resolves.toEqual(firstItems);
    await expect(
      fetchDanmakuComments(910003, undefined, { force: true }),
    ).resolves.toEqual(nextItems);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('带信号的显式刷新会把刷新参数传给服务端', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchDanmakuComments(910005, new AbortController().signal, {
        force: true,
      }),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/danmaku/comments?episodeId=910005&refresh=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('保留服务端按后台参数返回的完整弹幕队列', async () => {
    const items = Array.from({ length: 2500 }, (_, index) => ({
      text: `弹幕${index}`,
      time: index,
      mode: 0 as const,
      color: '#FFFFFF',
    }));
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items, total: items.length, truncated: false }),
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchDanmakuComments(910004)).resolves.toHaveLength(2500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
