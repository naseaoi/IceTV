import type { SearchResult } from '@/lib/types';

import {
  extractEpisodeNumberFromTitle,
  resolveEpisodeTargetIndex,
} from '@/features/play/lib/episodeMapping';

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

describe('episodeMapping', () => {
  it('能从常见集标题里提取集数', () => {
    expect(extractEpisodeNumberFromTitle('第06集')).toBe(6);
    expect(extractEpisodeNumberFromTitle('EP 12')).toBe(12);
    expect(extractEpisodeNumberFromTitle('01')).toBe(1);
    expect(extractEpisodeNumberFromTitle('SP1')).toBeNull();
    expect(extractEpisodeNumberFromTitle('特别篇')).toBeNull();
  });

  it('换源时会按逻辑集数映射到目标源，而不是直接复用数组下标', () => {
    const currentDetail = createSearchResult({
      episodes: ['a1', 'a2', 'a3'],
      episodes_titles: ['01', '02', '03'],
    });
    const targetDetail = createSearchResult({
      source: 'source-b',
      source_name: 'Source B',
      episodes: ['sp', 'b1', 'b2', 'b3'],
      episodes_titles: ['特别篇', '第1集', '第2集', '第3集'],
    });

    expect(resolveEpisodeTargetIndex(currentDetail, 1, targetDetail)).toEqual({
      index: 2,
      preserveProgress: true,
    });
  });

  it('目标源没有对应集数时会回退到安全索引', () => {
    const currentDetail = createSearchResult({
      episodes: ['a1', 'a2', 'a3'],
      episodes_titles: ['01', '02', '03'],
    });
    const targetDetail = createSearchResult({
      source: 'source-b',
      source_name: 'Source B',
      episodes: ['b1'],
      episodes_titles: ['第1集'],
    });

    expect(resolveEpisodeTargetIndex(currentDetail, 2, targetDetail)).toEqual({
      index: 0,
      preserveProgress: false,
    });
  });

  it('当前不是首集时，目标源若只能回退到第1集，应视为无法继承当前集', () => {
    const currentDetail = createSearchResult({
      episodes: ['a1', 'a2', 'a3', 'a4'],
      episodes_titles: ['01', '02', '03', '04'],
    });
    const targetDetail = createSearchResult({
      source: 'source-b',
      source_name: 'Source B',
      episodes: ['b1'],
      episodes_titles: ['第1集'],
    });

    expect(resolveEpisodeTargetIndex(currentDetail, 3, targetDetail)).toEqual({
      index: 0,
      preserveProgress: false,
    });
  });

  it('目标源在原集数基础上多了 OVA 时，按标题数字命中正集', () => {
    const currentDetail = createSearchResult({
      episodes: Array.from({ length: 12 }, (_, i) => `a${i + 1}`),
      episodes_titles: Array.from(
        { length: 12 },
        (_, i) => `${String(i + 1).padStart(2, '0')}`,
      ),
    });
    const targetDetail = createSearchResult({
      source: 'source-b',
      source_name: 'Source B',
      episodes: [...Array.from({ length: 12 }, (_, i) => `b${i + 1}`), 'b-ova'],
      episodes_titles: [
        ...Array.from({ length: 12 }, (_, i) => `第${i + 1}集`),
        'OVA',
      ],
    });

    expect(resolveEpisodeTargetIndex(currentDetail, 8, targetDetail)).toEqual({
      index: 8,
      preserveProgress: true,
    });
  });

  it('目标源标题里漏了当前集时拒绝按下标硬塞，preserveProgress=false', () => {
    const currentDetail = createSearchResult({
      episodes: Array.from({ length: 12 }, (_, i) => `a${i + 1}`),
      episodes_titles: Array.from(
        { length: 12 },
        (_, i) => `${String(i + 1).padStart(2, '0')}`,
      ),
    });
    // 目标源缺第 9 集，标题分别是 01..08, 10, 11, 12
    const targetDetail = createSearchResult({
      source: 'source-c',
      source_name: 'Source C',
      episodes: [
        'c1',
        'c2',
        'c3',
        'c4',
        'c5',
        'c6',
        'c7',
        'c8',
        'c10',
        'c11',
        'c12',
      ],
      episodes_titles: [
        '第1集',
        '第2集',
        '第3集',
        '第4集',
        '第5集',
        '第6集',
        '第7集',
        '第8集',
        '第10集',
        '第11集',
        '第12集',
      ],
    });

    expect(resolveEpisodeTargetIndex(currentDetail, 8, targetDetail)).toEqual({
      index: 8,
      preserveProgress: false,
    });
  });

  it('两边都没有 episodes_titles 且总集数相等时，按下标兜底视为可继承', () => {
    const currentDetail = createSearchResult({
      episodes: ['a1', 'a2', 'a3', 'a4'],
      episodes_titles: [],
    });
    const targetDetail = createSearchResult({
      source: 'source-b',
      source_name: 'Source B',
      episodes: ['b1', 'b2', 'b3', 'b4'],
      episodes_titles: [],
    });

    expect(resolveEpisodeTargetIndex(currentDetail, 2, targetDetail)).toEqual({
      index: 2,
      preserveProgress: true,
    });
  });

  it('两边都没有 episodes_titles 且总集数不同时，视为无法对齐当前集', () => {
    const currentDetail = createSearchResult({
      episodes: ['a1', 'a2', 'a3', 'a4'],
      episodes_titles: [],
    });
    const targetDetail = createSearchResult({
      source: 'source-b',
      source_name: 'Source B',
      episodes: ['b1', 'b2', 'b3'],
      episodes_titles: [],
    });

    expect(resolveEpisodeTargetIndex(currentDetail, 2, targetDetail)).toEqual({
      index: 2,
      preserveProgress: false,
    });
  });
});
