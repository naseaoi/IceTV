// 周历条目：服务端只给事实，星期推测与分组在客户端按本地时区完成
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

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

export const TRACKING_CALENDAR_INFER_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlacedCalendarItem extends TrackingCalendarItem {
  inferred: boolean;
}

export interface TrackingCalendarGroups {
  days: Record<Weekday, PlacedCalendarItem[]>;
  unscheduled: TrackingCalendarItem[];
}

export function toWeekday(date: Date): Weekday {
  const day = date.getDay();
  return (day === 0 ? 7 : day) as Weekday;
}

function isWeekday(value: number | null): value is Weekday {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 7;
}

function compareItems(a: TrackingCalendarItem, b: TrackingCalendarItem) {
  if (a.hasUpdate !== b.hasUpdate) return a.hasUpdate ? -1 : 1;
  const updatedDiff = (b.updateDetectedAt ?? 0) - (a.updateDetectedAt ?? 0);
  if (updatedDiff !== 0) return updatedDiff;
  return a.title.localeCompare(b.title, 'zh-CN');
}

export function groupTrackingCalendar(
  items: TrackingCalendarItem[],
  now: number,
): TrackingCalendarGroups {
  const days = Object.fromEntries(
    WEEKDAYS.map((weekday) => [weekday, [] as PlacedCalendarItem[]]),
  ) as Record<Weekday, PlacedCalendarItem[]>;
  const unscheduled: TrackingCalendarItem[] = [];

  for (const item of items) {
    if (isWeekday(item.airWeekday)) {
      days[item.airWeekday].push({ ...item, inferred: false });
      continue;
    }
    const detectedAt = item.updateDetectedAt;
    if (
      detectedAt !== null &&
      detectedAt <= now &&
      now - detectedAt <= TRACKING_CALENDAR_INFER_DAYS * DAY_MS
    ) {
      days[toWeekday(new Date(detectedAt))].push({ ...item, inferred: true });
      continue;
    }
    unscheduled.push(item);
  }

  for (const weekday of WEEKDAYS) days[weekday].sort(compareItems);
  unscheduled.sort(compareItems);
  return { days, unscheduled };
}

// 本周（周一起）各天的日期，用于列头显示
export function getWeekDates(now: Date): Record<Weekday, Date> {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (toWeekday(now) - 1));
  return Object.fromEntries(
    WEEKDAYS.map((weekday) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + weekday - 1);
      return [weekday, date];
    }),
  ) as Record<Weekday, Date>;
}

export function formatCalendarProgress(item: TrackingCalendarItem): string {
  const total =
    item.totalEpisodes && item.totalEpisodes > 0 ? item.totalEpisodes : null;
  if (item.episodeIndex === null) return total ? `共 ${total} 集` : '未开始';
  return total
    ? `看到 ${item.episodeIndex}/${total} 集`
    : `看到第 ${item.episodeIndex} 集`;
}
