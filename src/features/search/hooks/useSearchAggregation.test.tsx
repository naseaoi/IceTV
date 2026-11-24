import { act, renderHook, waitFor } from '@testing-library/react';

import {
  FilterState,
  reconcileSearchFilter,
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
  it.each([
    ['  Title  ', false],
    ['   ', true],
  ])('按非空关键词提前加载匹配模块：%j', async (searchQuery, waiting) => {
    const { result, rerender } = renderHook(
      ({ searchResults }: { searchResults: SearchResult[] }) =>
        useSearchAggregation({
          searchResults,
          filterAll: emptyFilter,
          filterAgg: emptyFilter,
          searchQuery,
        }),
      { initialProps: { searchResults: [] as SearchResult[] } },
    );

    expect(result.current.isMatchingLoading).toBe(false);
    await act(async () => {});
    rerender({ searchResults: [createResult({ title: 'Title' })] });

    expect(result.current.isMatchingLoading).toBe(waiting);
    expect(result.current.filteredAggResults).toHaveLength(waiting ? 0 : 1);
  });

  it('updates aggregated results when streaming search appends results', async () => {
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
    expect(result.current.isMatchingLoading).toBe(false);

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

    expect(result.current.isMatchingLoading).toBe(true);
    await waitFor(() =>
      expect(result.current.filteredAggResults).toHaveLength(1),
    );
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

  it('keeps only the selected source in aggregated playback group', async () => {
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

    await waitFor(() =>
      expect(result.current.filteredAggResults).toHaveLength(1),
    );
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

  it('keeps selected source card stats while streaming appends other sources', async () => {
    const lziResult = createResult({
      id: 'b',
      title: 'Re：从零开始的异世界生活',
      source: 'lzi',
      source_name: '量子资源',
      year: '2016',
    });
    const ffzyResult = createResult({
      id: 'a',
      title: 'Re：从零开始的异世界生活',
      source: 'ffzy',
      source_name: '非凡影视',
      year: '2016',
    });

    const { result, rerender } = renderHook(
      ({ searchResults }: { searchResults: SearchResult[] }) =>
        useSearchAggregation({
          searchResults,
          filterAll: emptyFilter,
          filterAgg: {
            ...emptyFilter,
            source: 'lzi',
          },
          searchQuery: '从零开始',
        }),
      {
        initialProps: { searchResults: [lziResult] },
      },
    );

    await waitFor(() => expect(result.current.isMatchingLoading).toBe(false));
    const item = result.current.filteredAggResults[0];
    const cardHandle = {
      setDoubanId: jest.fn(),
      setEpisodes: jest.fn(),
      setSourceNames: jest.fn(),
    };

    result.current.getGroupRef(item.mapKey).current = cardHandle;

    rerender({
      searchResults: [lziResult, ffzyResult],
    });

    await waitFor(() =>
      expect(result.current.filteredAggResults).toHaveLength(1),
    );
    expect(result.current.filteredAggResults[0].group).toEqual([
      expect.objectContaining({
        source: 'lzi',
        source_name: '量子资源',
      }),
    ]);
    expect(cardHandle.setSourceNames).not.toHaveBeenCalledWith([
      '量子资源',
      '非凡影视',
    ]);
    expect(cardHandle.setSourceNames).not.toHaveBeenCalled();
  });
});

it('聚合选项来自代表标题和年份，来源筛选不改变代表口径', async () => {
  const searchResults = [
    createResult({ id: 'a', title: 'Re：从零开始', year: '2026', source: 'a' }),
    createResult({
      id: 'b',
      title: 'Re:从零开始',
      year: 'unknown',
      source: 'b',
    }),
  ];
  const { result, rerender } = renderHook(
    ({ filterAgg }) =>
      useSearchAggregation({
        searchResults,
        filterAll: emptyFilter,
        filterAgg,
        searchQuery: '从零开始',
      }),
    { initialProps: { filterAgg: emptyFilter } },
  );
  await waitFor(() => expect(result.current.isMatchingLoading).toBe(false));
  const { categoriesAll, categoriesAgg } = result.current.filterOptions;
  const values = (categories: typeof categoriesAll, key: string) =>
    categories
      .find((category) => category.key === key)
      ?.options.map((option) => option.value);
  expect(values(categoriesAll, 'year')).toContain('unknown');
  expect(values(categoriesAll, 'title')).toContain('Re:从零开始');
  expect(values(categoriesAgg, 'year')).toEqual(['all', '2026']);
  expect(values(categoriesAgg, 'title')).toEqual(['all', 'Re：从零开始']);
  expect(values(categoriesAgg, 'source')).toEqual(
    expect.arrayContaining(['a', 'b']),
  );
  const selected = {
    ...emptyFilter,
    title: 'Re:从零开始',
    year: 'unknown',
    source: 'b',
  };
  expect(reconcileSearchFilter(selected, categoriesAgg)).toEqual({
    ...emptyFilter,
    source: 'b',
  });
  expect(reconcileSearchFilter(selected, categoriesAll)).toEqual(selected);
  rerender({
    filterAgg: {
      ...emptyFilter,
      title: 'Re：从零开始',
      year: '2026',
      source: 'b',
    },
  });
  expect(result.current.filteredAggResults).toHaveLength(1);
  expect(result.current.filteredAggResults[0]).toMatchObject({
    title: 'Re：从零开始',
    year: '2026',
    group: [expect.objectContaining({ source: 'b' })],
  });
});
