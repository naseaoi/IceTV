import {
  mapCmsSearchItem,
  parseCmsSearchPayload,
} from '@/lib/cms-search.server';
import { type ApiSite, API_CONFIG } from '@/lib/config';
import {
  readJsonLimited,
  readTextLimited,
  UPSTREAM_METADATA_MAX_BYTES,
} from '@/lib/proxy-response-limits';
import type { SearchResult } from '@/lib/types';
import { fetchUpstream } from '@/lib/upstream-fetch.server';

import { BROWSER_HTML_HEADERS, createTimedAbortController } from './shared';

export function isTyyszySource(apiSite: ApiSite): boolean {
  try {
    const hostname = new URL(apiSite.api).hostname;
    return hostname === 'tyyszy.com' || hostname.endsWith('.tyyszy.com');
  } catch {
    return false;
  }
}

// 单条卡片地址异常时跳过；结果容器缺失（拦截页、维护页、模板改版）或有卡片却一条都识别不出，
// 都按失败处理，以免静默变成空结果
function parseSearchIds(html: string): string[] {
  if (!/\bid\s*=\s*(["'])movieGrid\1/.test(html)) {
    throw new Error('天涯搜索页结构无法识别');
  }
  const ids = new Set<string>();
  let cards = 0;
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const className = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    if (!className?.split(/\s+/).includes('movie-card')) continue;
    cards++;
    const href = /\shref\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    const id = /^\/index\.php\/vod\/detail\/id\/(\d+)\.html$/.exec(
      href ?? '',
    )?.[1];
    if (id) ids.add(id);
  }
  if (cards > 0 && ids.size === 0) throw new Error('天涯搜索条目地址无法识别');
  return [...ids];
}

export async function searchFromTyyszy(
  apiSite: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  // 与其他特殊源一致只搜索第一页；网页与批量详情共用超时预算。
  // 失败直接抛出具体原因，由 searchSpecialSource 统一转为 SearchSourceUnavailableError，
  // 原因保留给 [search.failure] 日志与后台检测。
  const abortState = createTimedAbortController(signal, 10000);
  try {
    const origin = new URL(apiSite.api).origin;
    const response = await fetchUpstream(
      `${origin}/index.php/vod/search.html?wd=${encodeURIComponent(query)}`,
      { headers: BROWSER_HTML_HEADERS, signal: abortState.signal },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`天涯网页搜索失败 (${response.status})`);
    }
    const ids = parseSearchIds(
      await readTextLimited(response, UPSTREAM_METADATA_MAX_BYTES),
    );
    if (ids.length === 0) return [];

    const detailUrl = new URL(apiSite.api);
    detailUrl.searchParams.delete('wd');
    detailUrl.searchParams.delete('pg');
    detailUrl.searchParams.set('ac', 'detail');
    detailUrl.searchParams.set('ids', ids.join(','));
    const detailResponse = await fetchUpstream(detailUrl.toString(), {
      headers: API_CONFIG.detail.headers,
      signal: abortState.signal,
    });
    if (!detailResponse.ok) {
      await detailResponse.body?.cancel();
      throw new Error(`天涯批量详情失败 (${detailResponse.status})`);
    }
    const data = parseCmsSearchPayload(
      await readJsonLimited<unknown>(
        detailResponse,
        UPSTREAM_METADATA_MAX_BYTES,
      ),
    );
    if (!data) throw new Error('天涯批量详情响应无效');
    const byId = new Map(data.list.map((item) => [String(item.vod_id), item]));
    const items = ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    if (items.length === 0) throw new Error('天涯批量详情缺少搜索到的条目');
    // 与普通源一致：没有剧集的条目不展示，全部无剧集时按空结果处理
    return items
      .map((item) => mapCmsSearchItem(apiSite, item))
      .filter((result) => result.episodes.length > 0);
  } finally {
    abortState.cleanup();
  }
}
