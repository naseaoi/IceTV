import { normalizeInlineText } from '@/lib/utils';

export interface XgcartoonEpisodeEntry {
  chapterId: string;
  title: string;
}

export interface XgcartoonEpisodeVariant {
  groupId: string;
  label: string;
  isDefault: boolean;
  episodes: XgcartoonEpisodeEntry[];
}

export interface XgcartoonSearchResultItem {
  cartoonId: string;
  title: string;
  poster: string;
  author: string;
  tags: string[];
}

const XGCARTOON_EPISODE_LINK_REGEX =
  /href="\/user\/page_direct\?cartoon_id=([^&]+)&(?:amp;)?chapter_id=([^"]+)"[^>]*>[\s\S]*?<span[^>]*>(.*?)<\/span>/g;

const XGCARTOON_SEARCH_RESULT_REGEX =
  /href="\/detail\/([^"]+)"[^>]*class="topic-list-item"[\s\S]*?<amp-img[^>]+src="([^"]+)"[\s\S]*?<\/amp-img>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/g;

function cleanText(rawText: string): string {
  return normalizeInlineText(rawText.replace(/<[^>]+>/g, ' '));
}

// 从详情页URL提取cartoonId
export function parseXgcartoonDetailUrl(url: string): string | null {
  const match = url.match(/\/detail\/([^/?#]+)/);
  return match ? match[1] : null;
}

// 构建播放页URL
export function buildXgcartoonPlayUrl(
  cartoonId: string,
  chapterId: string,
): string {
  return `/user/page_direct?cartoon_id=${cartoonId}&chapter_id=${chapterId}`;
}

// 从详情页HTML提取剧集列表
export function extractXgcartoonEpisodes(
  html: string,
): XgcartoonEpisodeEntry[] {
  const matches = Array.from(html.matchAll(XGCARTOON_EPISODE_LINK_REGEX));
  if (matches.length === 0) {
    return [];
  }

  const episodes: XgcartoonEpisodeEntry[] = [];
  const seenChapterIds = new Set<string>();

  for (const match of matches) {
    const chapterId = match[2];
    const title = cleanText(match[3] || '');

    if (!chapterId || seenChapterIds.has(chapterId)) {
      continue;
    }

    seenChapterIds.add(chapterId);
    episodes.push({
      chapterId,
      title,
    });
  }

  return episodes;
}

// 提取剧集变体（多个播放源）
// 从详情页HTML提取分组的剧集列表
export function extractXgcartoonEpisodeVariants(
  html: string,
): XgcartoonEpisodeVariant[] {
  const variants: XgcartoonEpisodeVariant[] = [];

  // 查找所有季度标题
  const seasonMatches = Array.from(html.matchAll(/第(\d+)季【[^】]+】/g));

  if (seasonMatches.length === 0) {
    // 没有分季，提取所有剧集作为单个组
    const episodes = extractXgcartoonEpisodes(html);
    if (episodes.length === 0) {
      return [];
    }

    return [
      {
        groupId: '1',
        label: '默认源',
        isDefault: true,
        episodes,
      },
    ];
  }

  // 有多季，按季度分组
  for (let i = 0; i < seasonMatches.length; i++) {
    const seasonMatch = seasonMatches[i];
    const seasonNum = seasonMatch[1];
    const seasonTitle = seasonMatch[0];
    const seasonStartPos = seasonMatch.index || 0;

    // 确定这一季的结束位置（下一季的开始位置，或HTML末尾）
    const seasonEndPos =
      i < seasonMatches.length - 1
        ? seasonMatches[i + 1].index || html.length
        : html.length;

    // 提取这一季的HTML片段
    const seasonHtml = html.substring(seasonStartPos, seasonEndPos);

    // 从这一季的HTML中提取剧集
    const episodes = extractXgcartoonEpisodes(seasonHtml);

    if (episodes.length > 0) {
      variants.push({
        groupId: seasonNum,
        label: seasonTitle,
        isDefault: i === 0,
        episodes,
      });
    }
  }

  return variants;
}

// 从搜索结果页HTML提取动漫列表
export function extractXgcartoonSearchResults(
  html: string,
): XgcartoonSearchResultItem[] {
  const results: XgcartoonSearchResultItem[] = [];
  const seenIds = new Set<string>();

  const linkMatches = html.matchAll(
    /<a href="\/detail\/([^"]+)"[^>]*class="topic-list-item"/g,
  );

  for (const linkMatch of linkMatches) {
    const cartoonId = linkMatch[1];
    if (!cartoonId || seenIds.has(cartoonId)) {
      continue;
    }

    const linkStart = linkMatch.index || 0;
    const linkEnd = html.indexOf('</a>', linkStart);
    if (linkEnd === -1) {
      continue;
    }

    const linkHtml = html.substring(linkStart, linkEnd);

    const posterMatch = linkHtml.match(/<amp-img[^>]+src="([^"]+)"[^>]*>/);
    const poster = posterMatch ? posterMatch[1].replace(/&amp;/g, '&') : '';

    const titleMatch = linkHtml.match(/<div class="h3[^>]*>(.*?)<\/div>/);
    const title = titleMatch ? cleanText(titleMatch[1]) : '';

    const authorMatch = linkHtml.match(/([一-龥\w\s]+)\s*\[[^\]]+\]/);
    const author = authorMatch ? cleanText(authorMatch[1]) : '';

    if (!title) {
      continue;
    }

    seenIds.add(cartoonId);
    results.push({
      cartoonId,
      title,
      poster,
      author,
      tags: [],
    });
  }

  return results;
}
