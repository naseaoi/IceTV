import { act, renderHook } from '@testing-library/react';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { useSearchExecution } from '@/features/search/hooks/useSearchExecution';
import {
  type SearchSnapshot,
  clearSearchSnapshotCache,
  getSearchSnapshot,
  setSearchSnapshot,
} from '@/features/search/lib/searchSnapshotCache';
import { readFluidSearch } from '@/lib/local-preferences';

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
    failedSources: [],
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

  it('renders the result skeleton immediately for an uncached query', () => {
    const renders: ReturnType<typeof useExecution>[] = [];
    renderHook(() => {
      const state = useExecution('uncached');
      renders.push(state);
      return state;
    });
    expect(renders[0]).toMatchObject({
      showResults: true,
      isLoading: true,
      searchResults: [],
    });
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

  it('reopens the stream after StrictMode replays the effect', () => {
    const sources: { close: jest.Mock }[] = [];
    createEventSource.mockImplementation(() => {
      const source = { close: jest.fn() };
      sources.push(source);
      return source;
    });

    const { result } = renderHook(() => useExecution('fresh'), {
      wrapper: StrictMode,
    });

    expect(result.current.isLoading).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[sources.length - 1].close).not.toHaveBeenCalled();
  });

  it('hydrates without a mismatch even when the browser already has a snapshot', async () => {
    function SearchProbe() {
      const state = useExecution('cached');
      return (
        <div>
          {state.showResults && !state.isLoading
            ? state.searchResults[0]?.title
            : 'pending'}
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

describe('搜索失败反馈', () => {
  const originalFetch = global.fetch;
  const originalEventSource = global.EventSource;
  afterEach(() => {
    global.fetch = originalFetch;
    global.EventSource = originalEventSource;
    jest.mocked(readFluidSearch).mockReturnValue(true);
    clearSearchSnapshotCache();
  });
  it('普通请求失败不会写为空结果快照，重试可恢复', async () => {
    jest.mocked(readFluidSearch).mockReturnValue(false);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: '搜索失败' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    const { result } = renderHook(() => useExecution('failure'));
    await act(async () => {});
    expect(result.current.error).toBe('搜索失败');
    expect(getSearchSnapshot('failure')).toBeNull();
    await act(async () => result.current.retry());
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
  it('流式中断保留结果并标搜索未完成，取消旧查询不污染新查询', async () => {
    const streams: EventSource[] = [];
    global.EventSource = jest.fn(() => {
      const stream = { close: jest.fn() } as unknown as EventSource;
      streams.push(stream);
      return stream;
    }) as unknown as typeof EventSource;
    const { result, rerender } = renderHook(
      ({ query }) => useExecution(query),
      { initialProps: { query: 'partial' } },
    );
    await act(async () => {
      streams[0].onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'source_result',
            results: createSnapshot('item').results,
          }),
        }),
      );
      streams[0].onerror?.(new Event('error'));
    });
    expect(result.current.searchResults).toHaveLength(1);
    expect(result.current.error).toBe('搜索未完成');
    expect(getSearchSnapshot('partial')).toBeNull();
    rerender({ query: 'next' });
    act(() => streams[0].onerror?.(new Event('error')));
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });
  it('记录失败源，只重试失败源并把结果并入快照', async () => {
    const streams: { url: string; stream: EventSource }[] = [];
    global.EventSource = jest.fn((url: string) => {
      const stream = { close: jest.fn() } as unknown as EventSource;
      streams.push({ url, stream });
      return stream;
    }) as unknown as typeof EventSource;
    const send = (stream: EventSource, payload: object) =>
      stream.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify(payload) }),
      );
    const { result } = renderHook(() => useExecution('flaky'));
    const main = streams[0].stream;
    await act(async () => {
      send(main, { type: 'start', totalSources: 2 });
      send(main, {
        type: 'source_error',
        source: 'b',
        sourceName: 'B 源',
      });
      send(main, { type: 'source_result', source: 'a', results: [] });
      send(main, { type: 'complete', completedSources: 2 });
    });
    expect(result.current.failedSources).toEqual([{ key: 'b', name: 'B 源' }]);
    expect(getSearchSnapshot('flaky')?.failedSources).toEqual([
      { key: 'b', name: 'B 源' },
    ]);

    act(() => result.current.retryFailedSources());
    expect(result.current.retryingFailed).toBe(true);
    const retryUrl = new URL(streams[1].url, 'http://localhost');
    expect(retryUrl.pathname).toBe('/api/search/ws');
    expect(retryUrl.searchParams.get('q')).toBe('flaky');
    expect(retryUrl.searchParams.get('retry')).toBe('b');

    const retry = streams[1].stream;
    await act(async () => {
      send(retry, {
        type: 'source_result',
        source: 'b',
        results: createSnapshot('found').results,
      });
      send(retry, { type: 'complete' });
    });
    expect(result.current.retryingFailed).toBe(false);
    expect(result.current.failedSources).toEqual([]);
    expect(result.current.searchResults.map((item) => item.title)).toEqual([
      'found',
    ]);
    expect(getSearchSnapshot('flaky')).toMatchObject({
      failedSources: [],
      results: [expect.objectContaining({ title: 'found' })],
    });
  });

  it('普通请求读取失败源与源总数', async () => {
    jest.mocked(readFluidSearch).mockReturnValue(false);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        totalSources: 3,
        failedSources: [{ key: 'c', name: 'C' }, { bad: true }],
      }),
    });
    const { result } = renderHook(() => useExecution('classic'));
    await act(async () => {});
    expect(result.current.totalSources).toBe(3);
    expect(result.current.failedSources).toEqual([{ key: 'c', name: 'C' }]);
  });
});
