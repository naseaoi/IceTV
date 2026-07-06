import { runWithConcurrency, withAbortableTimeout } from '@/lib/concurrency';
import type { ApiSite } from '@/lib/config';
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
  sourceFailureCooldownMs?: number;
  shouldContinue?: () => boolean;
  onSourceResult?: (site: ApiSite, results: SearchResult[]) => void;
  onSourceError?: (site: ApiSite, error: unknown) => void;
}

type SourceFailureCooldown = {
  expiresAt: number;
  error: Error;
};

const DEFAULT_SOURCE_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const sourceFailureCooldowns = new Map<string, SourceFailureCooldown>();

export async function runSearchAggregation({
  apiSites,
  query,
  maxSearchPages,
  disableYellowFilter,
  sourceConcurrency,
  signal,
  sourceFailureCooldownMs,
  shouldContinue,
  onSourceResult,
  onSourceError,
}: SearchAggregationOptions): Promise<SearchResult[]> {
  const searchTasks = apiSites.map((site) => async () => {
    const cooldown = getSourceFailureCooldown(site, sourceFailureCooldownMs);
    if (cooldown) {
      onSourceError?.(site, cooldown.error);
      return [];
    }

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
      clearSourceFailureCooldown(site);
      onSourceResult?.(site, filteredResults);
      return filteredResults;
    } catch (error) {
      console.warn(
        `搜索失败 ${site.name}:`,
        error instanceof Error ? error.message : error,
      );
      if (!signal?.aborted) {
        markSourceFailureCooldown(site, error, sourceFailureCooldownMs);
      }
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

export function clearSearchSourceFailureCooldownsForTests(): void {
  sourceFailureCooldowns.clear();
}

function getSourceFailureCooldown(
  site: ApiSite,
  sourceFailureCooldownMs?: number,
): SourceFailureCooldown | null {
  const cooldownMs = getSourceFailureCooldownMs(sourceFailureCooldownMs);
  if (cooldownMs <= 0) return null;
  const key = getSourceFailureKey(site);
  const record = sourceFailureCooldowns.get(key);
  if (!record) return null;
  if (record.expiresAt > Date.now()) return record;
  sourceFailureCooldowns.delete(key);
  return null;
}

function markSourceFailureCooldown(
  site: ApiSite,
  error: unknown,
  sourceFailureCooldownMs?: number,
): void {
  const cooldownMs = getSourceFailureCooldownMs(sourceFailureCooldownMs);
  if (cooldownMs <= 0) return;

  sourceFailureCooldowns.set(getSourceFailureKey(site), {
    expiresAt: Date.now() + cooldownMs,
    error:
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : '搜索源失败'),
  });
}

function clearSourceFailureCooldown(site: ApiSite): void {
  sourceFailureCooldowns.delete(getSourceFailureKey(site));
}

function getSourceFailureKey(site: ApiSite): string {
  return site.key || site.api || site.name;
}

function getSourceFailureCooldownMs(sourceFailureCooldownMs?: number): number {
  if (
    sourceFailureCooldownMs !== undefined &&
    Number.isFinite(sourceFailureCooldownMs)
  ) {
    return Math.max(0, Math.floor(sourceFailureCooldownMs));
  }

  const configured = Number.parseInt(
    process.env.SEARCH_SOURCE_FAILURE_COOLDOWN_MS || '',
    10,
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_SOURCE_FAILURE_COOLDOWN_MS;
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
