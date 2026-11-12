import { isGroupedPlayRecordScale } from '@/lib/play-records';
import { formatTime } from '@/lib/player-utils';
import type { WatchHistoryEntry } from '@/lib/types';

export interface WatchHistoryDayGroup {
  key: string;
  label: string;
  entries: WatchHistoryEntry[];
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDayLabel(dayStart: number, todayStart: number): string {
  if (dayStart === todayStart) return '今天';
  if (dayStart === startOfLocalDay(todayStart - 1)) return '昨天';
  const date = new Date(dayStart);
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(todayStart).getFullYear()
    ? monthDay
    : `${date.getFullYear()}年${monthDay}`;
}

// 按最后观看的本地日期分组，保持传入顺序（接口已按时间倒序）
export function groupWatchHistoryByDay(
  entries: WatchHistoryEntry[],
  now = Date.now(),
): WatchHistoryDayGroup[] {
  const todayStart = startOfLocalDay(now);
  const groups = new Map<number, WatchHistoryDayGroup>();

  for (const entry of entries) {
    const dayStart = startOfLocalDay(entry.last_watched_at);
    let group = groups.get(dayStart);
    if (!group) {
      group = {
        key: String(dayStart),
        label: formatDayLabel(dayStart, todayStart),
        entries: [],
      };
      groups.set(dayStart, group);
    }
    group.entries.push(entry);
  }

  return Array.from(groups.values());
}

export function getWatchHistoryProgressPercent(
  entry: WatchHistoryEntry,
): number {
  if (!(entry.duration > 0)) return 0;
  return Math.min(100, Math.max(0, (entry.position / entry.duration) * 100));
}

// 分组源显示组内集数；单集作品只显示观看位置（迁移来的旧记录总集数可能为 0）
export function formatWatchHistoryProgress(entry: WatchHistoryEntry): string {
  const position = `看到 ${formatTime(Math.max(0, Math.floor(entry.position)))}`;
  if (isGroupedPlayRecordScale(entry)) {
    return `第 ${entry.group_index} 集 · ${position}`;
  }
  if (entry.total_episodes > 1 || entry.episode_index > 1) {
    return `第 ${entry.episode_index} 集 · ${position}`;
  }
  return position;
}
