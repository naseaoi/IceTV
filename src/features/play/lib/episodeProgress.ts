import {
  getEpisodeGroupIdentityLabel,
  hasUsableEpisodeGroups,
} from '@/lib/episode-groups';
import {
  type EpisodeProgressEntry,
  isEpisodeProgressKey,
} from '@/lib/episode-progress';
import type { SearchResult, SkipConfig } from '@/lib/types';

import { PLAYBACK_FINISHED_REMAINING_SECONDS } from './resumePlayback';

// 点开就切走的集不算看过：不写入每集进度，也不覆盖已有的看完记录
export const MIN_WATCHED_SECONDS = 10;
const SPECIAL_EPISODE_PATTERN =
  /^(?:sp|ova|oad|special|pv|cm)(?![a-z])|特别篇|特別篇|总集篇|總集篇|预告|預告|先行|番外/;
const EPISODE_NUMBER_PATTERNS = [
  /^(?:第\s*)?(\d{1,6}(?:\.\d{1,3})?)\s*[集话話回]?$/,
  /^ep?\s*\.?\s*(\d{1,6}(?:\.\d{1,3})?)$/,
  /第\s*(\d{1,6}(?:\.\d{1,3})?)\s*[集话話回]/,
];

// 只认明确的集号写法；日期、清晰度等混杂数字和特别篇都不当集号，宁可退回只认同源的索引身份
export function parseStrictEpisodeNumber(
  title: string | undefined,
): string | null {
  const normalized = (title || '').normalize('NFKC').trim().toLowerCase();
  if (!normalized || SPECIAL_EPISODE_PATTERN.test(normalized)) return null;
  for (const pattern of EPISODE_NUMBER_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) return String(Number(match[1]));
  }
  return null;
}

interface EpisodeScope {
  prefix: string;
  start: number;
  count: number;
}

function resolveEpisodeScopes(detail: SearchResult): EpisodeScope[] {
  const total = detail.episodes?.length || 0;
  const groups = detail.episode_groups;
  if (!hasUsableEpisodeGroups(groups, total)) {
    return [{ prefix: '', start: 0, count: total }];
  }
  let start = 0;
  return groups.map((group) => {
    const label = getEpisodeGroupIdentityLabel(group)
      .replace(/[|\u0000-\u001f]/g, '')
      .slice(0, 64);
    const scope = {
      prefix: label ? `g:${label}|` : '',
      start,
      count: group.count,
    };
    start += group.count;
    return scope;
  });
}

/**
 * 每一集的集身份。集号在所在分组（或整部）内唯一时用集号，可跨源对应；
 * 否则退回带源标识的序号，只在同一个源内续播。
 */
export function buildEpisodeProgressKeys(
  detail: Pick<
    SearchResult,
    'source' | 'episodes' | 'episodes_titles' | 'episode_groups'
  > | null,
): string[] {
  const total = detail?.episodes?.length || 0;
  if (!detail || total <= 1) return [];
  const keys: string[] = new Array(total);
  for (const scope of resolveEpisodeScopes(detail as SearchResult)) {
    const numbers = Array.from({ length: scope.count }, (_, offset) =>
      parseStrictEpisodeNumber(detail.episodes_titles?.[scope.start + offset]),
    );
    const counts = new Map<string, number>();
    numbers.forEach((n) => n && counts.set(n, (counts.get(n) ?? 0) + 1));
    numbers.forEach((n, offset) => {
      const key =
        n && counts.get(n) === 1
          ? `${scope.prefix}n:${n}`
          : `${scope.prefix}i:${detail.source}:${offset + 1}`;
      keys[scope.start + offset] = isEpisodeProgressKey(key) ? key : '';
    });
  }
  return keys;
}

export interface EpisodeProgressView {
  finished: boolean;
  ratio: number;
}

// 播到结尾才算看完，按比例判定会让长片在剩十多分钟时被当作看完、下次从头播；
// 设了跳过片尾时到片尾点也算看完，否则续播会落在片尾立刻被跳走
export function getEpisodeProgressView(
  entry: EpisodeProgressEntry | undefined,
  skipConfig?: Pick<SkipConfig, 'enable' | 'outro_time'> | null,
): EpisodeProgressView | null {
  if (!entry || entry.d <= 0 || entry.t < MIN_WATCHED_SECONDS) return null;
  const outroAt =
    skipConfig?.enable && skipConfig.outro_time < 0
      ? entry.d + skipConfig.outro_time
      : Infinity;
  const finished =
    entry.t >= entry.d - PLAYBACK_FINISHED_REMAINING_SECONDS ||
    entry.t >= outroAt;
  return { finished, ratio: finished ? 1 : Math.min(1, entry.t / entry.d) };
}

const LEAVE_FOR_NEXT_FINISHED_RATIO = 0.1;
const LEAVE_FOR_NEXT_FINISHED_MAX_SECONDS = 300;

// 片尾曲和下集预告常被直接跳过：主动切到下一集时剩余不超过时长 10%（最多 5 分钟）就算看完
export function isFinishedWhenLeavingForNext(
  time: number,
  duration: number,
): boolean {
  if (!(duration > 0) || time < MIN_WATCHED_SECONDS) return false;
  return (
    duration - time <=
    Math.min(
      duration * LEAVE_FOR_NEXT_FINISHED_RATIO,
      LEAVE_FOR_NEXT_FINISHED_MAX_SECONDS,
    )
  );
}

/** 切到某集时的续播点：看到一半从上次位置继续，看完或没有记录从头播 */
export function resolveEpisodeProgressResumeTime(
  entry: EpisodeProgressEntry | undefined,
  skipConfig?: Pick<SkipConfig, 'enable' | 'outro_time'> | null,
): number {
  const view = getEpisodeProgressView(entry, skipConfig);
  return view && !view.finished ? entry!.t : 0;
}
