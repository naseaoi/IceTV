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

const XGCARTOON_EPISODE_LINK_REGEX =
  /href="\/user\/page_direct\?cartoon_id=([^&]+)&(?:amp;)?chapter_id=([^"]+)"[^>]*>[\s\S]*?<span[^>]*>(.*?)<\/span>/g;

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
export function extractXgcartoonEpisodeVariants(
  html: string,
): XgcartoonEpisodeVariant[] {
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
