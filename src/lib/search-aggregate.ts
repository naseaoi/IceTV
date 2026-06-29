import type { ApiSite } from '@/lib/config';
import { runWithConcurrency, withAbortableTimeout } from '@/lib/concurrency';
import { searchFromApi } from '@/lib/downstream';
import type { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export interface SearchAggregationOptions {
  apiSites: ApiSite[];
  query: string;
  maxSearchPages: number;
  disableYellowFilter: boolean;
  sourceConcurrency: number;
  signal?: AbortSignal;
  shouldContinue?: () => boolean;
  onSourceResult?: (site: ApiSite, results: SearchResult[]) => void;
  onSourceError?: (site: ApiSite, error: unknown) => void;
}

export async function runSearchAggregation({
  apiSites,
  query,
  maxSearchPages,
  disableYellowFilter,
  sourceConcurrency,
  signal,
  shouldContinue,
  onSourceResult,
  onSourceError,
}: SearchAggregationOptions): Promise<SearchResult[]> {
  const searchTasks = apiSites.map((site) => async () => {
    try {
      const results = await withAbortableTimeout(
        (childSignal) =>
          searchFromApi(site, query, {
            maxSearchPages,
            signal: childSignal,
          }),
        20000,
        `${site.name} timeout`,
        signal,
      );
      const filteredResults = filterSearchResults(results, disableYellowFilter);
      onSourceResult?.(site, filteredResults);
      return filteredResults;
    } catch (error) {
      console.warn(
        `搜索失败 ${site.name}:`,
        error instanceof Error ? error.message : error,
      );
      onSourceError?.(site, error);
      return [];
    }
  });

  const results = await runWithConcurrency(
    searchTasks,
    sourceConcurrency,
    shouldContinue,
  );

  return results
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value);
}

function filterSearchResults(
  results: SearchResult[],
  disableYellowFilter: boolean,
): SearchResult[] {
  if (disableYellowFilter) {
    return results;
  }

  return results.filter((result) => {
    const typeName = result.type_name || '';
    return !yellowWords.some((word: string) => typeName.includes(word));
  });
}
