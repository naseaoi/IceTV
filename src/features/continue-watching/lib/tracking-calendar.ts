// 追更条目：服务端只给事实，与「今天」相关的文案在客户端按本地时区计算
export interface TrackingCalendarItem {
  key: string;
  source: string;
  id: string;
  title: string;
  searchTitle: string;
  year: string;
  cover: string;
  origin: 'record' | 'favorite';
  // 1 起的当前集与总集数；收藏没有观看进度时为 null
  episodeIndex: number | null;
  totalEpisodes: number | null;
  hasUpdate: boolean;
  updateDetectedAt: number | null;
  // Bangumi 日历命中时的播出星期，1 为周一
  airWeekday: number | null;
}

// 服务端首屏结果，供客户端判断是否需要重新验证
export interface TrackingStripSeed {
  items: TrackingCalendarItem[];
  // false 表示日历未在等待上限内返回，播出日可能缺失
  complete: boolean;
  // 0 表示没有完成查询
  fetchedAt: number;
}

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

export function toWeekday(date: Date): Weekday {
  const day = date.getDay();
  return (day === 0 ? 7 : day) as Weekday;
}

function isWeekday(value: number | null): value is Weekday {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 7;
}

// 追更区只收可立即续看的更新与有可靠播出日的作品；更新发现时间不是播出时间，不据此推测星期
export function isTrackingStripItem(item: TrackingCalendarItem): boolean {
  return item.hasUpdate || isWeekday(item.airWeekday);
}

// 顺序不依赖「今天」，服务端与客户端渲染一致：有更新在前，其余按周一到周日
export function sortTrackingStrip(
  items: TrackingCalendarItem[],
): TrackingCalendarItem[] {
  const weekdayRank = (item: TrackingCalendarItem) =>
    isWeekday(item.airWeekday) ? item.airWeekday : 8;
  return [...items].sort((a, b) => {
    if (a.hasUpdate !== b.hasUpdate) return a.hasUpdate ? -1 : 1;
    if (a.hasUpdate) {
      const updatedDiff = (b.updateDetectedAt ?? 0) - (a.updateDetectedAt ?? 0);
      if (updatedDiff !== 0) return updatedDiff;
    } else {
      const weekdayDiff = weekdayRank(a) - weekdayRank(b);
      if (weekdayDiff !== 0) return weekdayDiff;
    }
    return a.title.localeCompare(b.title, 'zh-CN');
  });
}

export type TrackingStripStatus =
  | { tone: 'update'; label: string }
  | { tone: 'today'; label: string }
  | { tone: 'scheduled'; label: string };

// today 为 null 时（服务端与水合前）只给出星期，避免与客户端时区不一致
export function getTrackingStripStatus(
  item: TrackingCalendarItem,
  today: Weekday | null,
): TrackingStripStatus | null {
  if (item.hasUpdate) return { tone: 'update', label: '有更新' };
  if (!isWeekday(item.airWeekday)) return null;
  if (today !== null) {
    const distance = (item.airWeekday - today + 7) % 7;
    if (distance === 0) return { tone: 'today', label: '今天更新' };
    if (distance === 1) return { tone: 'scheduled', label: '明天更新' };
  }
  return {
    tone: 'scheduled',
    label: `${WEEKDAY_LABELS[item.airWeekday]}更新`,
  };
}

export function formatCalendarProgress(item: TrackingCalendarItem): string {
  const total =
    item.totalEpisodes && item.totalEpisodes > 0 ? item.totalEpisodes : null;
  if (item.episodeIndex === null) return total ? `共 ${total} 集` : '未开始';
  return total
    ? `看到 ${item.episodeIndex}/${total} 集`
    : `看到第 ${item.episodeIndex} 集`;
}
