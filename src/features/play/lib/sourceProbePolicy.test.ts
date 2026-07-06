import { resolveSourceProbeEpisodeIndex } from '@/features/play/lib/sourceProbePolicy';
import type { SearchResult } from '@/lib/types';

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

describe('sourceProbePolicy', () => {
  it('首集测速仍使用目标源第1集', () => {
    const targetSource = createSearchResult({
      episodes: ['b1', 'b2'],
      episodes_titles: ['第1集', '第2集'],
    });

    expect(
      resolveSourceProbeEpisodeIndex({
        activeDetail: null,
        currentEpisodeIndex: 0,
        targetSource,
      }),
    ).toBe(0);
  });

  it('非首集测速会按逻辑集数映射到目标源', () => {
    const activeDetail = createSearchResult({
      episodes: ['a1', 'a2', 'a3'],
      episodes_titles: ['01', '02', '03'],
    });
    const targetSource = createSearchResult({
      source: 'source-b',
      source_name: 'Source B',
      episodes: ['sp', 'b1', 'b2', 'b3'],
      episodes_titles: ['特别篇', '第1集', '第2集', '第3集'],
    });

    expect(
      resolveSourceProbeEpisodeIndex({
        activeDetail,
        currentEpisodeIndex: 1,
        targetSource,
      }),
    ).toBe(2);
  });

  it('目标源无法承载当前集时返回 null', () => {
    const activeDetail = createSearchResult({
      episodes: ['a1', 'a2', 'a3', 'a4'],
      episodes_titles: ['01', '02', '03', '04'],
    });
    const targetSource = createSearchResult({
      source: 'source-b',
      source_name: 'Source B',
      episodes: ['b1'],
      episodes_titles: ['第1集'],
    });

    expect(
      resolveSourceProbeEpisodeIndex({
        activeDetail,
        currentEpisodeIndex: 3,
        targetSource,
      }),
    ).toBeNull();
  });
});
