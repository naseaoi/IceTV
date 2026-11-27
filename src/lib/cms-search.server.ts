import 'server-only';

import type { ApiSite } from '@/lib/config';
import { parseSeriesStatus } from '@/lib/series-status';
import type { SearchResult } from '@/lib/types';
import { cleanHtmlTags, normalizeInlineText } from '@/lib/utils';

export interface CmsSearchItem {
  vod_id: string | number;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_isend?: number | string;
  vod_serial?: number | string;
  vod_total?: number | string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

export function buildCmsSearchUrl(
  api: string,
  query: string,
  page = 1,
): string {
  const url = new URL(api);
  url.searchParams.set('ac', 'videolist');
  url.searchParams.set('wd', query);
  if (page === 1) url.searchParams.delete('pg');
  else url.searchParams.set('pg', String(page));
  // 沿用 encodeURIComponent：空格为 %20，且避免 URL.search 再次编码单引号。
  const search = Array.from(
    url.searchParams,
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  ).join('&');
  const hash = url.hash;
  url.search = '';
  url.hash = '';
  return `${url.toString()}?${search}${hash}`;
}

export function parseCmsSearchPayload(
  value: unknown,
): { list: CmsSearchItem[]; pageCount: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  // maccms 无结果时返回 list: null 且 total 为 0，属于正常空结果，不能记成源失败
  const rawList =
    data.list === null && [0, '0'].includes(data.total as number | string)
      ? []
      : data.list;
  if (
    (data.code !== undefined &&
      ((typeof data.code !== 'number' && typeof data.code !== 'string') ||
        ![1, 200].includes(Number(data.code)))) ||
    data.success === false ||
    !Array.isArray(rawList)
  ) {
    return null;
  }
  const list = rawList.filter((item): item is CmsSearchItem => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    return (
      typeof item.vod_name === 'string' &&
      ((typeof item.vod_id === 'string' && item.vod_id.trim().length > 0) ||
        (typeof item.vod_id === 'number' && Number.isFinite(item.vod_id)))
    );
  });
  if (rawList.length > 0 && list.length === 0) return null;
  const pageCount =
    typeof data.pagecount === 'number' || typeof data.pagecount === 'string'
      ? Number(data.pagecount)
      : 1;
  return {
    list,
    pageCount: Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 1,
  };
}

function isSupportedVodPlaybackUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.m3u8') || pathname.endsWith('.mp4');
  } catch {
    return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);
  }
}

export function parseVodPlayUrl(vodPlayUrl: string): {
  episodes: string[];
  titles: string[];
} {
  let episodes: string[] = [];
  let titles: string[] = [];

  const sources = vodPlayUrl.split('$$$');
  for (const source of sources) {
    const matchEpisodes: string[] = [];
    const matchTitles: string[] = [];
    const pairs = source.split('#');
    for (const pair of pairs) {
      const parts = pair.split('$');
      if (parts.length === 2 && isSupportedVodPlaybackUrl(parts[1])) {
        matchTitles.push(normalizeInlineText(parts[0]));
        matchEpisodes.push(parts[1]);
      }
    }
    if (matchEpisodes.length > episodes.length) {
      episodes = matchEpisodes;
      titles = matchTitles;
    }
  }

  return { episodes, titles };
}

export function mapCmsSearchItem(
  apiSite: ApiSite,
  item: CmsSearchItem,
): SearchResult {
  const { episodes, titles } = item.vod_play_url
    ? parseVodPlayUrl(item.vod_play_url)
    : { episodes: [], titles: [] };

  return {
    id: item.vod_id.toString(),
    title: normalizeInlineText(item.vod_name),
    poster: item.vod_pic,
    episodes,
    episodes_titles: titles,
    source: apiSite.key,
    source_name: apiSite.name,
    class: item.vod_class,
    year: item.vod_year ? item.vod_year.match(/\d{4}/)?.[0] || '' : 'unknown',
    desc: cleanHtmlTags(item.vod_content || ''),
    type_name: item.type_name,
    series_status: parseSeriesStatus({
      ...item,
      episodeCount: episodes.length,
    }),
    douban_id: item.vod_douban_id,
  };
}
