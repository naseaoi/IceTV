import { runWithConcurrency, withAbortableTimeout } from '@/lib/concurrency';
import type { ApiSite } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  type CachedSearchAggregateEntry,
  setUpstreamSearchConcurrency,
} from '@/lib/search-cache';
import { SearchSourceUnavailableError } from '@/lib/search-source-error';
import { isTitleMatchedSearchQuery } from '@/lib/search-text';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { getSourceCacheKey } from '@/lib/source-cache-key';
import {
  type SourceHealthTier,
  SOURCE_HEALTH_OFFLINE_SEARCH_TIMEOUT_MS,
} from '@/lib/source-quality-policy';
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
  sourceTimeoutMs?: number;
  sourceHealthTiers?: ReadonlyMap<string, SourceHealthTier>;
  shouldContinue?: () => boolean;
  // 用户主动重试失败源：跳过失败冷却与第 1 页缓存
  retryFailed?: boolean;
  onSourceResult?: (site: ApiSite, results: SearchResult[]) => void;
  onSourceError?: (site: ApiSite, error: unknown) => void;
}

type SourceFailureCooldown = {
  expiresAt: number;
  error: Error;
};

const DEFAULT_SOURCE_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_SOURCE_TIMEOUT_MS = 20_000;
const sourceFailureCooldowns = new Map<string, SourceFailureCooldown>();
// 聚合级准入独立于回源槽位，页缓存等待也受有界请求数保护。
const MAX_ACTIVE_AGGREGATIONS = 64;
let activeAggregations = 0;

export { getUpstreamSearchGateStats } from '@/lib/search-cache';

export async function runSearchAggregation({
  apiSites,
  query,
  maxSearchPages,
  disableYellowFilter,
  sourceConcurrency,
  signal,
  sourceFailureCooldownMs,
  sourceTimeoutMs,
  sourceHealthTiers,
  shouldContinue,
  retryFailed = false,
  onSourceResult,
  onSourceError,
}: SearchAggregationOptions): Promise<SearchResult[]> {
  const timeoutMs =
    sourceTimeoutMs && Number.isFinite(sourceTimeoutMs) && sourceTimeoutMs > 0
      ? sourceTimeoutMs
      : DEFAULT_SOURCE_TIMEOUT_MS;

  if (activeAggregations >= MAX_ACTIVE_AGGREGATIONS) {
    throw new ResourceLimitError(503, 1);
  }
  setUpstreamSearchConcurrency(sourceConcurrency);
  activeAggregations++;

  const searchTasks = apiSites.map((site) => async () => {
    const cooldown = retryFailed
      ? null
      : getSourceFailureCooldown(site, sourceFailureCooldownMs);
    if (cooldown) {
      onSourceError?.(site, cooldown.error);
      return [];
    }

    if (signal?.aborted || shouldContinue?.() === false) return [];

    let consumerSignal: AbortSignal | undefined;
    try {
      const results = await withAbortableTimeout(
        (childSignal) => {
          consumerSignal = childSignal;
          return searchFromApi(site, query, {
            maxSearchPages,
            signal: childSignal,
            reportFailure: true,
            refreshFirstPage: retryFailed,
          });
        },
        sourceHealthTiers?.get(site.key) === 'offline'
          ? Math.min(timeoutMs, SOURCE_HEALTH_OFFLINE_SEARCH_TIMEOUT_MS)
          : timeoutMs,
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
      // 消费预算包含排队/共享等待；预算耗尽和本站限额均不能证明整源故障。
      if (
        !consumerSignal?.aborted &&
        !signal?.aborted &&
        !(error instanceof SearchSourceUnavailableError) &&
        !(error instanceof ResourceLimitError)
      ) {
        markSourceFailureCooldown(site, error, sourceFailureCooldownMs);
      }
      onSourceError?.(site, error);
      return [];
    }
  });

  try {
    const results = await runWithConcurrency(
      searchTasks,
      sourceConcurrency,
      () => !signal?.aborted && shouldContinue?.() !== false,
    );
    return results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);
  } finally {
    activeAggregations--;
  }
}

// 聚合并记录失败源，供缓存与客户端区分“没搜到”和“没搜全”
export async function collectSearchAggregation(
  options: SearchAggregationOptions,
): Promise<CachedSearchAggregateEntry> {
  const failedSources: string[] = [];
  const results = await runSearchAggregation({
    ...options,
    onSourceError: (site, error) => {
      if (!options.signal?.aborted) failedSources.push(site.key);
      options.onSourceError?.(site, error);
    },
  });
  return { results, failedSources };
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

  const now = Date.now();
  sourceFailureCooldowns.forEach((record, key) => {
    if (record.expiresAt <= now) sourceFailureCooldowns.delete(key);
  });
  sourceFailureCooldowns.set(getSourceFailureKey(site), {
    expiresAt: now + cooldownMs,
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
  return getSourceCacheKey(site);
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
