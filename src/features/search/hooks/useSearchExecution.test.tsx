import { act, renderHook } from '@testing-library/react';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { useSearchExecution } from '@/features/search/hooks/useSearchExecution';
import {
  type SearchSnapshot,
  clearSearchSnapshotCache,
  getSearchSnapshot,
  setSearchSnapshot,
} from '@/features/search/lib/searchSnapshotCache';

jest.mock('@/lib/db.client', () => ({ addSearchHistory: jest.fn() }));
jest.mock('@/lib/local-preferences', () => ({
  readFluidSearch: jest.fn(() => true),
}));

function createSnapshot(title: string): SearchSnapshot {
  return {
    results: [
      {
        id: title,
        title,
        poster: '/poster.jpg',
        episodes: ['/episode.m3u8'],
        episodes_titles: ['Episode 1'],
        year: '2026',
        source: 'source',
        source_name: 'Source',
      },
    ],
    totalSources: 4,
    completedSources: 4,
    useFluidSearch: false,
  };
}

function useExecution(query: string) {
  return useSearchExecution({
    searchParams: new URLSearchParams({ q: query }) as ReadonlyURLSearchParams,
    viewMode: 'agg',
    filterAggYearOrder: 'none',
    filterAllYearOrder: 'none',
  });
}

describe('useSearchExecution cached navigation', () => {
  const originalEventSource = global.EventSource;
  const createEventSource = jest.fn(() => ({ close: jest.fn() }));

  beforeEach(() => {
    clearSearchSnapshotCache();
    createEventSource.mockClear();
    global.EventSource = createEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    global.EventSource = originalEventSource;
    clearSearchSnapshotCache();
  });

  it('restores cached results during the first client render without searching again', () => {
    const snapshot = createSnapshot('cached');
    setSearchSnapshot('cached', snapshot);
    const renders: ReturnType<typeof useExecution>[] = [];

    renderHook(() => {
      const state = useExecution('cached');
      renders.push(state);
      return state;
    });

    expect(renders[0]).toMatchObject({
      showResults: true,
      isLoading: false,
      searchResults: snapshot.results,
      totalSources: 4,
      completedSources: 4,
      useFluidSearch: false,
    });
    expect(createEventSource).not.toHaveBeenCalled();
  });

  it('keeps an empty cached result instead of repeating the request', () => {
    setSearchSnapshot('empty', { ...createSnapshot('empty'), results: [] });

    const { result } = renderHook(() => useExecution('empty'));

    expect(result.current.showResults).toBe(true);
    expect(result.current.searchResults).toEqual([]);
    expect(createEventSource).not.toHaveBeenCalled();
  });

  it('does not overwrite another query snapshot with the previous results', () => {
    const firstSnapshot = createSnapshot('first');
    const secondSnapshot = createSnapshot('second');
    setSearchSnapshot('first', firstSnapshot);
    setSearchSnapshot('second', secondSnapshot);
    const { result, rerender } = renderHook(
      ({ query }) => useExecution(query),
      {
        initialProps: { query: 'first' },
      },
    );

    rerender({ query: 'second' });

    expect(result.current.searchResults).toEqual(secondSnapshot.results);
    expect(getSearchSnapshot('first')).toEqual(firstSnapshot);
    expect(getSearchSnapshot('second')).toEqual(secondSnapshot);
  });

  it('starts a request when navigating from cached results to an uncached query', () => {
    setSearchSnapshot('cached', createSnapshot('cached'));
    const { result, rerender } = renderHook(
      ({ query }) => useExecution(query),
      {
        initialProps: { query: 'cached' },
      },
    );

    rerender({ query: 'new' });

    expect(result.current.searchResults).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    expect(createEventSource).toHaveBeenCalledWith('/api/search/ws?q=new');
    expect(getSearchSnapshot('new')).toBeNull();
  });

  it('hydrates without a mismatch even when the browser already has a snapshot', async () => {
    function SearchProbe() {
      const state = useExecution('cached');
      return (
        <div>
          {state.showResults ? state.searchResults[0]?.title : 'pending'}
        </div>
      );
    }

    setSearchSnapshot('cached', createSnapshot('cached'));
    const serverHtml = renderToString(<SearchProbe />);
    expect(serverHtml).toContain('pending');
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    const errors: unknown[] = [];
    const root = hydrateRoot(container, <SearchProbe />, {
      onRecoverableError: (error) => errors.push(error),
    });

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(errors).toEqual([]);
      expect(container.textContent).toBe('cached');
      expect(createEventSource).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
