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
      const filteredResults = filterSearchResults(
        results,
        query,
        disableYellowFilter,
      );
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
  query: string,
  disableYellowFilter: boolean,
): SearchResult[] {
  return results.filter((result) => {
    const typeName = result.type_name || '';
    if (
      !disableYellowFilter &&
      yellowWords.some((word: string) => typeName.includes(word))
    ) {
      return false;
    }

    return isTitleMatchedSearchQuery(result.title || '', query);
  });
}

function normalizeSearchMatchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[《》「」『』【】()[\]（）]/g, '')
    .replace(/[\s\u00a0\u3000·•・.。:：,，!！?？'"`~～_\-—]/g, '');
}

function isTitleMatchedSearchQuery(title: string, query: string): boolean {
  const normalizedTitle = normalizeSearchMatchText(title);
  const normalizedQuery = normalizeSearchMatchText(query);

  if (!normalizedQuery) {
    return true;
  }

  return normalizedTitle.includes(normalizedQuery);
}
