import 'server-only';

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
  if (
    (data.code !== undefined &&
      ((typeof data.code !== 'number' && typeof data.code !== 'string') ||
        ![1, 200].includes(Number(data.code)))) ||
    data.success === false ||
    !Array.isArray(data.list)
  ) {
    return null;
  }
  const list = data.list.filter((item): item is CmsSearchItem => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    return (
      typeof item.vod_name === 'string' &&
      ((typeof item.vod_id === 'string' && item.vod_id.trim().length > 0) ||
        (typeof item.vod_id === 'number' && Number.isFinite(item.vod_id)))
    );
  });
  if (data.list.length > 0 && list.length === 0) return null;
  const pageCount =
    typeof data.pagecount === 'number' || typeof data.pagecount === 'string'
      ? Number(data.pagecount)
      : 1;
  return {
    list,
    pageCount: Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 1,
  };
}
