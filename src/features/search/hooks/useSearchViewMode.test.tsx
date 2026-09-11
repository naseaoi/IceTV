import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { useSearchViewMode } from '@/features/search/hooks/useSearchViewMode';
import { readAggregateSearch } from '@/lib/local-preferences';

jest.mock('@/lib/local-preferences', () => ({
  readAggregateSearch: jest.fn(() => true),
}));

const storageKey = 'searchViewModeByQuery';

describe('useSearchViewMode', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.mocked(readAggregateSearch).mockReturnValue(true);
  });

  it('restores the saved mode on the first render in strict mode', () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ cached: 'all' }));
    const renders: string[] = [];

    const { result } = renderHook(
      () => {
        const state = useSearchViewMode(' Cached ');
        renders.push(state[0]);
        return state;
      },
      { wrapper: StrictMode },
    );

    expect(renders.every((mode) => mode === 'all')).toBe(true);
    expect(result.current[0]).toBe('all');
    expect(JSON.parse(sessionStorage.getItem(storageKey) || '{}')).toEqual({
      cached: 'all',
    });
  });

  it('preserves each query mode when switching queries', () => {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ first: 'all', second: 'agg' }),
    );
    const { result, rerender } = renderHook(
      ({ query }) => useSearchViewMode(query),
      { initialProps: { query: 'first' } },
    );

    rerender({ query: 'second' });
    expect(result.current[0]).toBe('agg');
    rerender({ query: 'first' });
    expect(result.current[0]).toBe('all');
    expect(JSON.parse(sessionStorage.getItem(storageKey) || '{}')).toEqual({
      first: 'all',
      second: 'agg',
    });
  });

  it('persists manual changes without changing other queries', () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ other: 'all' }));
    const { result } = renderHook(() => useSearchViewMode('cached'));

    act(() => result.current[1]('all'));

    expect(JSON.parse(sessionStorage.getItem(storageKey) || '{}')).toEqual({
      other: 'all',
      cached: 'all',
    });
  });

  it.each(['null', '[]', '{broken', '{"cached":"invalid"}'])(
    'uses the local preference when storage is invalid: %s',
    (raw) => {
      sessionStorage.setItem(storageKey, raw);
      jest.mocked(readAggregateSearch).mockReturnValue(false);

      const { result } = renderHook(() => useSearchViewMode('cached'));

      expect(result.current[0]).toBe('all');
    },
  );

  it('hydrates without overwriting the cached mode with the server default', async () => {
    function ViewModeProbe() {
      const [mode] = useSearchViewMode('cached');
      return <span>{mode}</span>;
    }

    sessionStorage.setItem(storageKey, JSON.stringify({ cached: 'all' }));
    const serverHtml = renderToString(<ViewModeProbe />);
    expect(serverHtml).toContain('agg');
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    const errors: unknown[] = [];
    const root = hydrateRoot(
      container,
      <StrictMode>
        <ViewModeProbe />
      </StrictMode>,
      { onRecoverableError: (error) => errors.push(error) },
    );

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(errors).toEqual([]);
      expect(container.textContent).toBe('all');
      expect(JSON.parse(sessionStorage.getItem(storageKey) || '{}')).toEqual({
        cached: 'all',
      });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
