import type { SearchResult } from '@/lib/types';
import { normalizeInlineText } from '@/lib/utils';

export function isGirigiriUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      /^https?:$/.test(url.protocol) &&
      /(?:^|\.)girigirilove\./i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export function normalizeGirigiriHttpUrl(
  value: unknown,
  origin?: string,
): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim(), origin);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function parseGirigiriVariantId(rawId: string): {
  videoId: string;
  groupId: string | null;
} {
  const match = rawId.match(/^(.*)__giri_(\d+)$/);
  return match
    ? { videoId: match[1], groupId: match[2] }
    : { videoId: rawId, groupId: null };
}

// 与旧站 playerconfig.js 的 show 一致；标签参与历史分组与每集进度身份。
const GROUP_LABELS: Record<string, string> = {
  cht: '繁中',
  chs: '简中',
  DB: '杜比',
};

export function parseGirigiriPlaylists(
  playFrom: unknown,
  playUrl: unknown,
): Pick<SearchResult, 'episodes' | 'episodes_titles' | 'episode_groups'> {
  if (typeof playFrom !== 'string' || typeof playUrl !== 'string') {
    throw new Error('girigiri 剧集响应无效');
  }
  const codes = playFrom.split('$$$');
  const playlists = playUrl.split('$$$');
  if (codes.length !== playlists.length) {
    throw new Error('girigiri 剧集分组不匹配');
  }
  const episodes: string[] = [];
  const titles: string[] = [];
  const groups: NonNullable<SearchResult['episode_groups']> = [];
  playlists.forEach((playlist, groupIndex) => {
    if (!playlist.trim()) return;
    const entries = playlist.split('#');
    entries.forEach((entry, index) => {
      const separator = entry.indexOf('$');
      const url = normalizeGirigiriHttpUrl(
        separator >= 0 ? entry.slice(separator + 1) : '',
      );
      // 跳过坏集会移动后续绝对索引，宁可报告异常也不让历史续播到其他集。
      if (!url) throw new Error('girigiri 剧集地址无效');
      episodes.push(url);
      titles.push(
        normalizeInlineText(entry.slice(0, separator)) || `${index + 1}`,
      );
    });
    const code = normalizeInlineText(codes[groupIndex]);
    groups.push({
      label: Object.hasOwn(GROUP_LABELS, code)
        ? GROUP_LABELS[code]
        : code || `版本${groupIndex + 1}`,
      count: entries.length,
    });
  });
  if (episodes.length === 0) throw new Error('girigiri 暂无可播放剧集');
  return {
    episodes,
    episodes_titles: titles,
    episode_groups: groups.length > 1 ? groups : undefined,
  };
}
