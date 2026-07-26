import {
  resolveEpisodeGroupPosition,
  shouldInheritCrossGroupProgress,
} from '@/features/play/lib/episodeGroups';
import type { SearchResult } from '@/lib/types';

function createGiriDetail(overrides?: Partial<SearchResult>): SearchResult {
  return {
    id: '101',
    title: 'Multi Version Anime',
    poster: '',
    episodes: [
      'icetv-lazy://giri/playGV101-1-1/',
      'icetv-lazy://giri/playGV101-1-2/',
      'icetv-lazy://giri/playGV101-2-1/',
      'icetv-lazy://giri/playGV101-2-2/',
    ],
    episodes_titles: ['繁中01', '繁中02', '简中01', '简中02'],
    source: 'giri',
    source_name: 'Giri',
    year: '2024',
    episode_groups: [
      { label: '繁中', count: 2 },
      { label: '简中', count: 2 },
    ],
    ...overrides,
  };
}

describe('resolveEpisodeGroupPosition', () => {
  const groups = [
    { label: '繁中', count: 12 },
    { label: '简中', count: 12 },
  ];

  it('把全局索引换算成组内位置', () => {
    expect(resolveEpisodeGroupPosition(groups, 0, 24)).toEqual({
      groupIndex: 0,
      episodeOffset: 0,
      groupCount: 12,
    });
    expect(resolveEpisodeGroupPosition(groups, 12, 24)).toEqual({
      groupIndex: 1,
      episodeOffset: 0,
      groupCount: 12,
    });
    expect(resolveEpisodeGroupPosition(groups, 23, 24)).toEqual({
      groupIndex: 1,
      episodeOffset: 11,
      groupCount: 12,
    });
  });

  it('分组信息无效时返回 null', () => {
    expect(resolveEpisodeGroupPosition(undefined, 0, 24)).toBeNull();
    expect(
      resolveEpisodeGroupPosition([{ label: '全集', count: 24 }], 0, 24),
    ).toBeNull();
    // 组总数与集数对不上
    expect(resolveEpisodeGroupPosition(groups, 0, 25)).toBeNull();
    // 索引越界
    expect(resolveEpisodeGroupPosition(groups, 24, 24)).toBeNull();
    expect(resolveEpisodeGroupPosition(groups, -1, 24)).toBeNull();
  });
});

describe('shouldInheritCrossGroupProgress', () => {
  it('giri 不同分组同一集时继承', () => {
    const detail = createGiriDetail();
    expect(shouldInheritCrossGroupProgress(detail, 0, 2)).toBe(true);
    expect(shouldInheritCrossGroupProgress(detail, 3, 1)).toBe(true);
  });

  it('同组内切集不继承', () => {
    const detail = createGiriDetail();
    expect(shouldInheritCrossGroupProgress(detail, 0, 1)).toBe(false);
  });

  it('跨组但集数不同不继承', () => {
    const detail = createGiriDetail();
    expect(shouldInheritCrossGroupProgress(detail, 0, 3)).toBe(false);
  });

  it('非 giri 源不继承', () => {
    const detail = createGiriDetail({
      episodes: [
        'https://cdn.example/1.m3u8',
        'https://cdn.example/2.m3u8',
        'https://cdn.example/3.m3u8',
        'https://cdn.example/4.m3u8',
      ],
    });
    expect(shouldInheritCrossGroupProgress(detail, 0, 2)).toBe(false);
  });

  it('无分组信息不继承', () => {
    const detail = createGiriDetail({ episode_groups: undefined });
    expect(shouldInheritCrossGroupProgress(detail, 0, 2)).toBe(false);
    expect(shouldInheritCrossGroupProgress(null, 0, 2)).toBe(false);
  });
});
