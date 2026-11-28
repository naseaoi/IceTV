import { createHash } from 'node:crypto';

import type { ApiSite } from '@/lib/config';
import type { SearchResult } from '@/lib/types';
import { cleanHtmlTags, normalizeInlineText } from '@/lib/utils';

import { requestSourceJson } from './request.server';
import { matchesSiteHost, toAbsoluteUrl } from './shared';

const API_ORIGIN = 'https://api.olelive.com';
// 实测搜索返回的 upload/vod/... 相对路径在该静态域返回 200 image/jpeg。
const IMAGE_ORIGIN = 'https://static.olelive.com/';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? normalizeInlineText(value) : '';
}

function positiveId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value);
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? id : null;
}

function timestampSignature(): string {
  // 源站公开前端的秒级时间签名，每次回源重新计算，不是密钥。
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bits = ['', '', '', ''];
  for (const char of timestamp) {
    const binary = char.charCodeAt(0).toString(2);
    bits[0] += binary.slice(2, 3);
    bits[1] += binary.slice(3, 4);
    bits[2] += binary.slice(4, 5);
    bits[3] += binary.slice(5);
  }
  const parts = bits.map((part) =>
    parseInt(part, 2).toString(16).padStart(3, '0'),
  );
  const hash = createHash('md5').update(timestamp).digest('hex');
  return (
    hash.slice(0, 3) +
    parts[0] +
    hash.slice(6, 11) +
    parts[1] +
    hash.slice(14, 19) +
    parts[2] +
    hash.slice(22, 27) +
    parts[3] +
    hash.slice(30)
  );
}

async function requestOlevod(path: string, signal?: AbortSignal) {
  return object(
    await requestSourceJson(
      '欧乐',
      `${API_ORIGIN}${path}?_vv=${timestampSignature()}`,
      { headers: { Accept: 'application/json' }, signal },
    ),
  );
}

export function isOlevodSource(site: ApiSite): boolean {
  return matchesSiteHost(site, 'olevod.com');
}

function toSearchResult(site: ApiSite, value: unknown): SearchResult | null {
  const item = object(value);
  if (!item) return null;
  const id = positiveId(item.id);
  const title = text(item.name);
  if (!id || !title) return null;
  const year = String(item.year ?? '');
  return {
    id,
    title,
    poster: toAbsoluteUrl(text(item.picThumb) || text(item.pic), IMAGE_ORIGIN),
    episodes: [],
    episodes_titles: [],
    source: site.key,
    source_name: site.name,
    year: /^\d{4}$/.test(year) ? year : 'unknown',
    desc: cleanHtmlTags(text(item.content) || text(item.blurb)),
    type_name: text(item.typeId1Name) || text(item.typeIdName),
    class: text(item.class),
    series_status: text(item.remarks) === '完结' ? 'ended' : undefined,
    douban_id: 0,
  };
}

export async function searchFromOlevod(
  site: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const payload = await requestOlevod(
    `/v1/pub/index/search/${encodeURIComponent(query)}/vod/0/1/10`,
    signal,
  );
  const data = object(payload?.data);
  const group = Array.isArray(data?.data)
    ? data.data.map(object).find((item) => item?.type === 'vod')
    : null;
  if (payload?.code === 0 && group?.list === null && group.total === 0) {
    return [];
  }
  if (payload?.code !== 0 || !Array.isArray(group?.list)) {
    throw new Error('欧乐搜索响应无效');
  }
  // 实测 46008、45746、6795 的搜索 vip=true，游客 /true 详情地址全空；
  // 普通电影与剧集 vip=false 有明文地址，画质“超清”本身不代表 VIP。
  const publicItems = group.list.filter((item) => object(item)?.vip !== true);
  const results = publicItems
    .map((item) => toSearchResult(site, item))
    .filter((item): item is SearchResult => item !== null);
  if (publicItems.length > 0 && results.length === 0) {
    throw new Error('欧乐搜索响应无效');
  }
  return results;
}

export async function getDetailFromOlevod(
  site: ApiSite,
  id: string,
): Promise<SearchResult> {
  if (!positiveId(id)) throw new Error('无效的欧乐编号');
  const payload = await requestOlevod(`/v1/pub/vod/detail/${id}/true`);
  const data = object(payload?.data);
  const result = toSearchResult(site, data);
  if (
    payload?.code !== 0 ||
    !result ||
    result.id !== id ||
    !Array.isArray(data?.urls)
  ) {
    throw new Error('欧乐详情响应无效');
  }
  const isMovie = data.typeId1 === 1 || data.typeId1 === 6;
  for (const value of data.urls) {
    const episode = object(value);
    const url = text(episode?.url);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = text(episode?.title);
    const number = positiveId(episode?.index);
    result.episodes.push(url);
    result.episodes_titles.push(
      isMovie
        ? title || '正片'
        : number
          ? `第${number}集`
          : title || `第${result.episodes.length}集`,
    );
  }
  if (result.episodes.length === 0) throw new Error('欧乐暂无可播放剧集');
  return result;
}
