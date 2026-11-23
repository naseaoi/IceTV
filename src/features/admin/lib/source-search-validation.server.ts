import { type ApiSite, API_CONFIG } from '@/lib/config';
import {
  isGirigiriSource,
  searchFromGirigiri,
} from '@/lib/downstream-sources/giri';
import {
  isXgcartoonSource,
  searchFromXgcartoon,
} from '@/lib/downstream-sources/xgcartoon';
import { isXifanSource, searchFromXifan } from '@/lib/downstream-sources/xifan';
import {
  readJsonLimited,
  UPSTREAM_METADATA_MAX_BYTES,
} from '@/lib/proxy-response-limits';
import { searchWithScriptFallback } from '@/lib/search-script-fallback';
import { isTitleMatchedSearchQuery } from '@/lib/search-text';
import { fetchWithUrlGuard } from '@/lib/url-guard';

export function isSpecialSearchSource(site: ApiSite): boolean {
  return (
    isGirigiriSource(site) || isXgcartoonSource(site) || isXifanSource(site)
  );
}

async function validateSourceSearchQuery(
  site: ApiSite,
  query: string,
  signal: AbortSignal,
): Promise<'valid' | 'no_results'> {
  const search = isGirigiriSource(site)
    ? searchFromGirigiri
    : isXgcartoonSource(site)
      ? searchFromXgcartoon
      : isXifanSource(site)
        ? searchFromXifan
        : null;
  if (search) {
    const results = await search(site, query, signal);
    // 特殊源在消费者取消时可能返回 []；检测超时仍属于失败。
    if (signal.aborted) throw new Error('源搜索检测已中止');
    return results.some((item) => isTitleMatchedSearchQuery(item.title, query))
      ? 'valid'
      : 'no_results';
  }

  const url = new URL(site.api);
  url.searchParams.set('ac', 'videolist');
  url.searchParams.set('wd', query);
  const response = await fetchWithUrlGuard(url.toString(), {
    headers: API_CONFIG.search.headers,
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`源搜索请求失败 (${response.status})`);
  }
  const data = await readJsonLimited<{
    code?: unknown;
    success?: unknown;
    list?: unknown;
  } | null>(response, UPSTREAM_METADATA_MAX_BYTES);
  if (
    !data ||
    (data.code !== undefined && ![1, 200].includes(Number(data.code))) ||
    data.success === false ||
    !Array.isArray(data.list) ||
    data.list.some((item) => !item || typeof item.vod_name !== 'string')
  ) {
    throw new Error('源搜索响应无效或未开放搜索');
  }
  return data.list.some((item) =>
    isTitleMatchedSearchQuery(item.vod_name, query),
  )
    ? 'valid'
    : 'no_results';
}

export async function validateSourceSearch(
  site: ApiSite,
  query: string,
  signal: AbortSignal,
): Promise<'valid' | 'no_results'> {
  return searchWithScriptFallback(
    query,
    (keyword) => validateSourceSearchQuery(site, keyword, signal),
    (status) => status === 'valid',
    signal,
  );
}
