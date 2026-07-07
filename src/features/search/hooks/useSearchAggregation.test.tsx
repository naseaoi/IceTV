import { renderHook } from '@testing-library/react';

import {
  FilterState,
  useSearchAggregation,
} from '@/features/search/hooks/useSearchAggregation';
import type { SearchResult } from '@/lib/types';

const emptyFilter: FilterState = {
  source: 'all',
  title: 'all',
  year: 'all',
  yearOrder: 'none',
};

function createResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id || 'id',
    title: partial.title || 'Title',
    poster: partial.poster || '',
    episodes: partial.episodes || ['https://example.com/video.m3u8'],
    episodes_titles: partial.episodes_titles || ['1'],
    source: partial.source || 'source-a',
    source_name: partial.source_name || 'Source A',
    year: partial.year || '2026',
    ...partial,
  };
}

describe('useSearchAggregation', () => {
  it('updates aggregated results when streaming search appends results', () => {
    const { result, rerender } = renderHook(
      ({ searchResults }: { searchResults: SearchResult[] }) =>
        useSearchAggregation({
          searchResults,
          filterAll: emptyFilter,
          filterAgg: emptyFilter,
          searchQuery: '从零开始',
        }),
      {
        initialProps: { searchResults: [] as SearchResult[] },
      },
    );

    expect(result.current.filteredAggResults).toHaveLength(0);

    rerender({
      searchResults: [
        createResult({
          id: '1',
          title: 'Re：从零开始的异世界生活',
          source: 'ffzy',
          source_name: '非凡影视',
          year: '2016',
        }),
      ],
    });

    expect(result.current.filteredAggResults).toHaveLength(1);
    expect(result.current.filteredAggResults[0].title).toBe(
      'Re：从零开始的异世界生活',
    );
    expect(
      result.current.filterOptions.categoriesAgg[0].options,
    ).toContainEqual({
      label: '非凡影视',
      value: 'ffzy',
    });
  });

  it('keeps only the selected source in aggregated playback group', () => {
    const { result } = renderHook(() =>
      useSearchAggregation({
        searchResults: [
          createResult({
            id: 'a',
            title: 'Re：从零开始的异世界生活',
            source: 'ffzy',
            source_name: '非凡影视',
            year: '2016',
          }),
          createResult({
            id: 'b',
            title: 'Re：从零开始的异世界生活',
            source: 'lzi',
            source_name: '量子资源',
            year: '2016',
          }),
        ],
        filterAll: emptyFilter,
        filterAgg: {
          ...emptyFilter,
          source: 'lzi',
        },
        searchQuery: '从零开始',
      }),
    );

    expect(result.current.filteredAggResults).toHaveLength(1);
    expect(result.current.filteredAggResults[0].group).toEqual([
      expect.objectContaining({
        source: 'lzi',
        source_name: '量子资源',
      }),
    ]);
    expect(result.current.filteredAggResults[0].stats.source_names).toEqual([
      '量子资源',
    ]);
  });
});
