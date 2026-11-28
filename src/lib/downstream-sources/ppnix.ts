import type { ApiSite } from '@/lib/config';
import type { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

import { requestSourceText } from './request.server';
import {
  BROWSER_HTML_HEADERS,
  getSiteOrigin,
  matchesSiteHost,
  toAbsoluteUrl,
} from './shared';

export function isPpnixSource(site: ApiSite): boolean {
  return matchesSiteHost(site, 'ppnix.com');
}

function attribute(tag: string, name: string): string {
  return cleanHtmlTags(
    new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2] ?? '',
  );
}

export async function searchFromPpnix(
  site: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const origin = getSiteOrigin(site);
  const { text: html } = await requestSourceText(
    'PPnix',
    `${origin}/cn/search/${encodeURIComponent(query)}--.html`,
    { headers: BROWSER_HTML_HEADERS, signal },
  );
  // 实测空结果同样保留 lists-content > ul，分页链接位于容器之外。
  const list =
    /<div\b[^>]*\bclass=["']lists-content["'][^>]*>\s*<ul\b[^>]*>([\s\S]*?)<\/ul>/i.exec(
      html,
    )?.[1];
  if (list === undefined) throw new Error('PPnix 搜索页结构无法识别');
  const cards = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
  const results = new Map<string, SearchResult>();
  for (const [, card] of cards) {
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(card)?.[1] ?? '';
    const link = /<a\b[^>]*>/i.exec(heading)?.[0] ?? '';
    const match = /^\/cn\/(movie|tv)\/([1-9]\d*)\.html$/.exec(
      attribute(link, 'href'),
    );
    const title = cleanHtmlTags(heading);
    if (!match || !title) continue;
    const [, kind, number] = match;
    const id = `${kind}-${number}`;
    const image = /<img\b[^>]*>/i.exec(card)?.[0] ?? '';
    const year = cleanHtmlTags(
      /<span\b[^>]*\bclass=["']orange["'][^>]*>([\s\S]*?)<\/span>/i.exec(
        card,
      )?.[1] ?? '',
    );
    results.set(id, {
      id,
      title,
      poster: toAbsoluteUrl(attribute(image, 'src'), origin),
      year: /^\d{4}$/.test(year) ? year : 'unknown',
      type_name: kind === 'movie' ? '电影' : '电视剧',
      episodes: [],
      episodes_titles: [],
      source: site.key,
      source_name: site.name,
      douban_id: 0,
    });
  }
  if (/<li\b/i.test(list) && results.size === 0) {
    throw new Error('PPnix 搜索条目无法识别');
  }
  return [...results.values()];
}

export async function getDetailFromPpnix(
  site: ApiSite,
  id: string,
): Promise<SearchResult> {
  const match = /^(movie|tv)-([1-9]\d*)$/.exec(id);
  if (!match || match[0] !== id) throw new Error('无效的 PPnix 作品编号');
  const [, kind, number] = match;
  const origin = getSiteOrigin(site);
  const { text: html } = await requestSourceText(
    'PPnix',
    `${origin}/cn/${kind}/${number}.html`,
    { headers: BROWSER_HTML_HEADERS },
  );
  const header =
    /<header\b[^>]*\bclass=["']product-header["'][^>]*>([\s\S]*?)<\/header>/i.exec(
      html,
    )?.[1] ?? '';
  const heading =
    /<h1\b[^>]*\bclass=["']product-title["'][^>]*>([\s\S]*?)<\/h1>/i.exec(
      header,
    )?.[1] ?? '';
  const title = cleanHtmlTags(heading.split(/<span\b/i)[0]);
  if (!title) throw new Error('PPnix 详情页结构无法识别');
  const image = /<img\b[^>]*>/i.exec(header)?.[0] ?? '';
  const year = /<span\b[^>]*>\s*\(([^)]*)\)/i.exec(heading)?.[1] ?? '';
  const excerpts = new Map<string, string>();
  for (const [, label, content] of header.matchAll(
    /<div\b[^>]*\bclass=["']product-excerpt["'][^>]*>\s*([^<：]+)：\s*<span>([\s\S]*?)<\/span>\s*<\/div>/gi,
  )) {
    excerpts.set(label.trim(), cleanHtmlTags(content));
  }

  // 源站 ppnix.js 以 infoid 和 m3u8 数组参数直接拼地址，无签名或逐集回源。
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((item) => item[1])
    .find((text) => /\binfoid\s*=\s*(\d+)\s*;/.exec(text)?.[1] === number);
  const array = /\bm3u8\s*=\s*\[([^\]]*)\]/.exec(script ?? '')?.[1] ?? '';
  let params = [
    ...new Set(
      array.split(',').flatMap((item) => {
        const value = /^\s*(["'])([1-9]\d*P?)\1\s*$/.exec(item)?.[2];
        return value ? [value] : [];
      }),
    ),
  ];
  if (kind === 'movie') {
    // 实测电影 2484 仅列 1080P，清单返回 200；多个画质时按页面标注取最高档。
    params = params
      .filter((value) => /^\d+P$/.test(value))
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
      .slice(0, 1);
  } else {
    params = params
      .filter((value) => /^\d+$/.test(value))
      .sort((a, b) => Number(a) - Number(b));
  }
  const episodes: string[] = [];
  const episodesTitles: string[] = [];
  for (const param of params) {
    const url = toAbsoluteUrl(`/info/m3u8/${number}/${param}.m3u8`, origin);
    if (!/^https?:\/\//i.test(url)) continue;
    episodes.push(url);
    episodesTitles.push(kind === 'movie' ? '正片' : `第${param}集`);
  }
  if (episodes.length === 0) throw new Error('PPnix 暂无可播放剧集');
  return {
    id,
    title,
    poster: toAbsoluteUrl(attribute(image, 'src'), origin),
    year: /^\d{4}$/.test(year) ? year : 'unknown',
    desc: excerpts.get('简介') ?? '',
    class: excerpts.get('类型') ?? '',
    type_name: kind === 'movie' ? '电影' : '电视剧',
    episodes,
    episodes_titles: episodesTitles,
    source: site.key,
    source_name: site.name,
    douban_id: 0,
  };
}
