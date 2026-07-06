import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import type { ApiSite } from '@/lib/config';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { getDetailFromApi, searchFirstPageFromApi } from '@/lib/downstream';
import { filterSourcesForPlayback } from '@/lib/source-match';
import type { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

const QUICK_SOURCE_LIMIT = 10;
const QUICK_SOURCE_CONCURRENCY = 4;
const QUICK_DETAIL_LIMIT_PER_SOURCE = 2;

type QuickSearchPayload = {
  detail: SearchResult | null;
  sources: SearchResult[];
  searchedSources: number;
};

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();
  const year = searchParams.get('year') || '';
  const searchTypeParam = searchParams.get('stype') || '';
  const searchType =
    searchTypeParam === 'tv' || searchTypeParam === 'movie'
      ? searchTypeParam
      : '';

  if (!query) {
    return NextResponse.json(
      {
        detail: null,
        sources: [],
        searchedSources: 0,
      } satisfies QuickSearchPayload,
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const config = await getConfigForRead();
  const apiSites = await getAvailableApiSites(guardResult.username, config);
  const quickSites = apiSites.slice(0, QUICK_SOURCE_LIMIT);
  const controller = new AbortController();

  const payload = await resolveQuickPlayableSource({
    apiSites: quickSites,
    query,
    year,
    searchType,
    disableYellowFilter: config.SiteConfig.DisableYellowFilter,
    signal: controller.signal,
    onResolved: () => controller.abort(),
  });

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

async function resolveQuickPlayableSource({
  apiSites,
  query,
  year,
  searchType,
  disableYellowFilter,
  signal,
  onResolved,
}: {
  apiSites: ApiSite[];
  query: string;
  year: string;
  searchType: '' | 'tv' | 'movie';
  disableYellowFilter: boolean;
  signal: AbortSignal;
  onResolved: () => void;
}): Promise<QuickSearchPayload> {
  if (apiSites.length === 0) {
    return { detail: null, sources: [], searchedSources: 0 };
  }

  return new Promise((resolve) => {
    const sources: SearchResult[] = [];
    let nextIndex = 0;
    let running = 0;
    let searchedSources = 0;
    let settled = false;

    const finish = (detail: SearchResult | null) => {
      if (settled) return;
      settled = true;
      if (detail) onResolved();
      resolve({
        detail,
        sources: mergeQuickSources(detail ? [detail, ...sources] : sources),
        searchedSources,
      });
    };

    const pump = () => {
      if (settled) return;

      while (
        running < QUICK_SOURCE_CONCURRENCY &&
        nextIndex < apiSites.length &&
        !signal.aborted
      ) {
        const site = apiSites[nextIndex];
        nextIndex += 1;
        running += 1;
        searchedSources += 1;

        searchQuickSite({
          site,
          query,
          year,
          searchType,
          disableYellowFilter,
          signal,
        })
          .then((result) => {
            if (settled) return;
            sources.push(...result.sources);
            if (result.detail) finish(result.detail);
          })
          .catch(() => undefined)
          .finally(() => {
            running -= 1;
            if (settled) return;
            if (nextIndex >= apiSites.length && running === 0) {
              finish(null);
              return;
            }
            pump();
          });
      }

      if (nextIndex >= apiSites.length && running === 0) {
        finish(null);
      }
    };

    pump();
  });
}

async function searchQuickSite({
  site,
  query,
  year,
  searchType,
  disableYellowFilter,
  signal,
}: {
  site: ApiSite;
  query: string;
  year: string;
  searchType: '' | 'tv' | 'movie';
  disableYellowFilter: boolean;
  signal: AbortSignal;
}): Promise<{ detail: SearchResult | null; sources: SearchResult[] }> {
  if (signal.aborted) return { detail: null, sources: [] };

  const searchResults = await searchFirstPageFromApi(site, query, { signal });
  if (signal.aborted) return { detail: null, sources: [] };

  const matchedSources = filterSourcesForPlayback(
    filterYellowResults(searchResults, disableYellowFilter),
    {
      title: query,
      year,
      searchType,
    },
  );

  for (const source of matchedSources.slice(0, QUICK_DETAIL_LIMIT_PER_SOURCE)) {
    const playable = await fetchPlayableDetail(site, source);
    if (playable) {
      return { detail: playable, sources: matchedSources };
    }
  }

  return {
    detail: matchedSources.find((source) => source.episodes.length > 0) || null,
    sources: matchedSources,
  };
}

async function fetchPlayableDetail(
  site: ApiSite,
  source: SearchResult,
): Promise<SearchResult | null> {
  try {
    const detail = await getDetailFromApi(site, source.id);
    if (!detail.episodes || detail.episodes.length === 0) return null;
    return {
      ...source,
      ...detail,
      title: detail.title || source.title,
      poster: detail.poster || source.poster,
      year:
        detail.year && detail.year !== 'unknown'
          ? detail.year
          : source.year || detail.year,
    };
  } catch {
    return null;
  }
}

function filterYellowResults(
  results: SearchResult[],
  disableYellowFilter: boolean,
): SearchResult[] {
  if (disableYellowFilter) return results;
  return results.filter(
    (result) =>
      !yellowWords.some((word: string) =>
        (result.type_name || '').includes(word),
      ),
  );
}

function mergeQuickSources(sources: SearchResult[]): SearchResult[] {
  const deduped = new Map<string, SearchResult>();
  for (const source of sources) {
    if (!source.source || !source.id) continue;
    const key = `${source.source}::${source.id}`;
    if (!deduped.has(key)) deduped.set(key, source);
  }
  return Array.from(deduped.values());
}
