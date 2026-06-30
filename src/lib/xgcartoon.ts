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

const XGCARTOON_VIDEO_CDN_ORIGIN = 'https://xgct-video.bzcdn.net';
const XGCARTOON_VARIANT_ID_REGEX = /^(.*)__xg_(.+)$/;
const XGCARTOON_PLAYER_VID_REGEX =
  /player\.htm\?[^"'<>]*\bvid=([0-9a-f-]{16,})/i;
const XGCARTOON_VOLUME_TITLE_REGEX =
  /<div\b[^>]*class="[^"]*\bvolume-title\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
const XGCARTOON_LEGACY_SEASON_REGEX = /第(\d+)季【[^】]+】/g;

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
  return `/user/page_direct?cartoon_id=${encodeURIComponent(cartoonId)}&chapter_id=${encodeURIComponent(chapterId)}`;
}

export function buildXgcartoonVideoPath(
  cartoonId: string,
  chapterId: string,
): string {
  return `/video/${encodeURIComponent(cartoonId)}/${encodeURIComponent(chapterId)}.html`;
}

export function buildXgcartoonVariantId(
  cartoonId: string,
  groupId: string,
  isDefault: boolean,
): string {
  return isDefault ? cartoonId : `${cartoonId}__xg_${groupId}`;
}

export function parseXgcartoonVariantId(id: string): {
  cartoonId: string;
  groupId: string | null;
} {
  const match = id.match(XGCARTOON_VARIANT_ID_REGEX);
  if (!match) {
    return { cartoonId: id, groupId: null };
  }

  return {
    cartoonId: match[1],
    groupId: match[2],
  };
}

export function buildXgcartoonPlaylistUrl(videoId: string): string {
  return `${XGCARTOON_VIDEO_CDN_ORIGIN}/${encodeURIComponent(videoId)}/playlist.m3u8`;
}

export function extractXgcartoonPlayerVid(html: string): string | null {
  const normalizedHtml = html.replace(/&amp;/g, '&');
  const match = normalizedHtml.match(XGCARTOON_PLAYER_VID_REGEX);
  return match ? match[1] : null;
}

function parseEpisodeAnchors(
  html: string,
  requireChapterClass: boolean,
): XgcartoonEpisodeEntry[] {
  const anchorMatches = Array.from(
    html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g),
  );
  const episodes: XgcartoonEpisodeEntry[] = [];
  const seenChapterIds = new Set<string>();

  for (const match of anchorMatches) {
    const attrs = match[1] || '';
    if (requireChapterClass && !/\bgoto-chapter\b/.test(attrs)) {
      continue;
    }

    const hrefMatch = attrs.match(
      /href="\/user\/page_direct\?cartoon_id=([^"&]+)&(?:amp;)?chapter_id=([^"]+)"/,
    );
    if (!hrefMatch) {
      continue;
    }

    const chapterId = hrefMatch[2];
    const titleAttr = attrs.match(/\btitle="([^"]*)"/)?.[1] || '';
    const spanTitle =
      match[2].match(/<span[^>]*>([\s\S]*?)<\/span>/)?.[1] || '';
    const title = cleanText(titleAttr || spanTitle || match[2] || '');

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

// 从详情页HTML提取分组的剧集列表
export function extractXgcartoonEpisodes(
  html: string,
): XgcartoonEpisodeEntry[] {
  const chapterEpisodes = parseEpisodeAnchors(html, true);
  return chapterEpisodes.length > 0
    ? chapterEpisodes
    : parseEpisodeAnchors(html, false);
}

export function extractXgcartoonEpisodeVariants(
  html: string,
): XgcartoonEpisodeVariant[] {
  const volumeMatches = Array.from(
    html.matchAll(XGCARTOON_VOLUME_TITLE_REGEX),
  ).map((match, index) => {
    const start = match.index || 0;
    return {
      groupId: `${index + 1}`,
      label: cleanText(match[1] || ''),
      start,
      end: start + match[0].length,
    };
  });

  const groupedVolumes =
    volumeMatches.length > 0
      ? volumeMatches
      : Array.from(html.matchAll(XGCARTOON_LEGACY_SEASON_REGEX)).map(
          (match, index) => {
            const start = match.index || 0;
            return {
              groupId: match[1] || `${index + 1}`,
              label: cleanText(match[0] || ''),
              start,
              end: start + match[0].length,
            };
          },
        );

  if (groupedVolumes.length === 0) {
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

  return groupedVolumes
    .map((volumeMatch, index) => {
      const nextMatch = groupedVolumes[index + 1];
      const volumeHtml = html.substring(
        volumeMatch.end,
        nextMatch?.start || html.length,
      );
      const episodes = extractXgcartoonEpisodes(volumeHtml);

      if (episodes.length === 0) {
        return null;
      }

      return {
        groupId: volumeMatch.groupId,
        label: volumeMatch.label,
        isDefault: index === 0,
        episodes,
      };
    })
    .filter((variant): variant is XgcartoonEpisodeVariant => Boolean(variant));
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
