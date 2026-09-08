'use client';

import { useEffect, useState } from 'react';

import { useClientHydrated } from '@/hooks/useClientHydrated';
import { readAggregateSearch } from '@/lib/local-preferences';

type SearchViewMode = 'agg' | 'all';

const SEARCH_VIEW_MODE_STORAGE_KEY = 'searchViewModeByQuery';

function readSearchViewModes(): Record<string, SearchViewMode> {
  try {
    const raw = sessionStorage.getItem(SEARCH_VIEW_MODE_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).filter(
        ([, mode]) => mode === 'agg' || mode === 'all',
      ),
    );
  } catch {
    return {};
  }
}

function getSearchViewMode(query: string): SearchViewMode {
  const modes = readSearchViewModes();
  return Object.hasOwn(modes, query)
    ? modes[query]
    : readAggregateSearch()
      ? 'agg'
      : 'all';
}

function saveSearchViewMode(query: string, viewMode: SearchViewMode) {
  if (!query) return;

  try {
    const modes = { ...readSearchViewModes(), [query]: viewMode };
    sessionStorage.setItem(SEARCH_VIEW_MODE_STORAGE_KEY, JSON.stringify(modes));
  } catch {}
}

export function useSearchViewMode(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const clientHydrated = useClientHydrated();
  const [viewMode, setViewMode] = useState<SearchViewMode>(() =>
    clientHydrated ? getSearchViewMode(normalizedQuery) : 'agg',
  );
  const [restoredQuery, setRestoredQuery] = useState<string | null>(
    clientHydrated ? normalizedQuery : null,
  );

  useEffect(() => {
    setViewMode(getSearchViewMode(normalizedQuery));
    setRestoredQuery(normalizedQuery);
  }, [normalizedQuery]);

  useEffect(() => {
    if (restoredQuery !== normalizedQuery) return;
    saveSearchViewMode(normalizedQuery, viewMode);
  }, [normalizedQuery, restoredQuery, viewMode]);

  return [viewMode, setViewMode] as const;
}
