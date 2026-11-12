import { createAsyncSemaphore } from '@/lib/async-semaphore';
import { getUpstreamSearchConcurrency } from '@/lib/cache-budget-profile';
import { runWithConcurrency, withAbortableTimeout } from '@/lib/concurrency';
import type { ApiSite } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import type { CachedSearchAggregateEntry } from '@/lib/search-cache';
import { SearchSourceUnavailableError } from '@/lib/search-source-error';
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
const SEARCH_GATE_MAX_WAITING_PER_SLOT = 32;
const SEARCH_GATE_WAIT_TIMEOUT_MS = 30_000;
const sourceFailureCooldowns = new Map<string, SourceFailureCooldown>();

// 跨请求共享：多人同时搜索时上游请求排队而不是叠加
const upstreamSearchGate = createAsyncSemaphore(getUpstreamSearchConcurrency());

export function getUpstreamSearchGateStats() {
  return upstreamSearchGate.stats();
}

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

  upstreamSearchGate.setLimit(sourceConcurrency);

  const searchTasks = apiSites.map((site) => async () => {
    const cooldown = retryFailed
      ? null
      : getSourceFailureCooldown(site, sourceFailureCooldownMs);
    if (cooldown) {
      onSourceError?.(site, cooldown.error);
      return [];
    }

    // 先取闸门再起超时，排队时间不占用单源超时预算
    let releaseGate: () => void;
    try {
      releaseGate = await upstreamSearchGate.acquire({
        signal,
        maxWaiting:
          upstreamSearchGate.stats().limit * SEARCH_GATE_MAX_WAITING_PER_SLOT,
        waitTimeoutMs: SEARCH_GATE_WAIT_TIMEOUT_MS,
      });
    } catch (error) {
      // 本机排队繁忙或请求已取消，不是源站故障，不进入失败冷却
      if (!signal?.aborted) onSourceError?.(site, error);
      return [];
    }
    if (signal?.aborted || shouldContinue?.() === false) {
      releaseGate();
      return [];
    }

    try {
      const results = await withAbortableTimeout(
        (childSignal) =>
          searchFromApi(site, query, {
            maxSearchPages,
            signal: childSignal,
            reportFailure: true,
            refreshFirstPage: retryFailed,
          }),
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
      // 单页失败已由页缓存短期记住，不再整源冷却
      if (
        !signal?.aborted &&
        !(error instanceof SearchSourceUnavailableError)
      ) {
        markSourceFailureCooldown(site, error, sourceFailureCooldownMs);
      }
      onSourceError?.(site, error);
      return [];
    } finally {
      releaseGate();
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
