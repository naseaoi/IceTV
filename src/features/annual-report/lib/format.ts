import type { RecapReport } from '@/features/annual-report/lib/audience';

export function durationParts(seconds: number): {
  hours: number;
  minutes: number;
} {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export function formatDuration(seconds: number): string {
  const { hours, minutes } = durationParts(seconds);
  if (hours === 0) return minutes === 0 ? '不到 1 分钟' : `${minutes} 分钟`;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

// 列表里的短格式：超过 10 小时只保留小时
export function formatDurationShort(seconds: number): string {
  const { hours, minutes } = durationParts(seconds);
  if (hours === 0) return minutes === 0 ? '<1 分钟' : `${minutes} 分钟`;
  if (hours >= 10 || minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分`;
}

export function formatDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month} 月 ${day} 日`;
}

export function formatInstantDate(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('month')} 月 ${value('day')} 日`;
}

export function formatClock(localTime: string): string {
  const [hour, minute] = localTime.split(':').map(Number);
  const prefix =
    hour < 5 ? '凌晨' : hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';
  return `${prefix} ${hour}:${String(minute).padStart(2, '0')}`;
}

// 23:00 至次日 5:00 之间才算熬夜
export function isLateNight(localTime: string): boolean {
  const hour = Number(localTime.split(':')[0]);
  return hour >= 23 || hour < 5;
}

export type DaypartKey =
  | 'dawn'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night';

export type Daypart = {
  key: DaypartKey;
  persona: string;
  range: string;
  // 首尾小时，end 不含；跨午夜时 start > end
  start: number;
  end: number;
};

export const DAYPARTS: Daypart[] = [
  { key: 'dawn', persona: '晨光观众', range: '5–9 点', start: 5, end: 9 },
  {
    key: 'morning',
    persona: '上午场常客',
    range: '9–12 点',
    start: 9,
    end: 12,
  },
  { key: 'noon', persona: '午休放映员', range: '12–14 点', start: 12, end: 14 },
  {
    key: 'afternoon',
    persona: '午后漫游者',
    range: '14–18 点',
    start: 14,
    end: 18,
  },
  {
    key: 'evening',
    persona: '黄金档主角',
    range: '18–23 点',
    start: 18,
    end: 23,
  },
  { key: 'night', persona: '深夜放映员', range: '23–5 点', start: 23, end: 5 },
];

function daypartHours(part: Daypart): number[] {
  const hours: number[] = [];
  for (let hour = part.start; hour !== part.end; hour = (hour + 1) % 24) {
    hours.push(hour);
  }
  return hours;
}

export function daypartOfHour(hour: number): Daypart {
  return DAYPARTS.find((part) => daypartHours(part).includes(hour))!;
}

// 时段按小时均值比较，避免长时段天然占优
export function dominantDaypart(hours: number[]): Daypart | null {
  let best: Daypart | null = null;
  let bestAverage = 0;
  for (const part of DAYPARTS) {
    const range = daypartHours(part);
    const average =
      range.reduce((sum, hour) => sum + (hours[hour] ?? 0), 0) / range.length;
    if (average > bestAverage) {
      best = part;
      bestAverage = average;
    }
  }
  return best;
}

export function peakIndex(values: number[]): number {
  let best = -1;
  values.forEach((value, index) => {
    if (value > 0 && (best < 0 || value > values[best])) best = index;
  });
  return best;
}

export function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

const MOVIE_SECONDS = 2 * 60 * 60;

export function watchComparison(seconds: number): string | null {
  const days = seconds / 86_400;
  if (days >= 2) return `相当于不眠不休看了 ${days.toFixed(1)} 天`;
  const movies = Math.round(seconds / MOVIE_SECONDS);
  if (movies >= 2) return `差不多是 ${movies} 部电影的长度`;
  return null;
}

export type SlideKey =
  | 'intro'
  | 'time'
  | 'months'
  | 'hours'
  | 'night'
  | 'peak'
  | 'streak'
  | 'top'
  | 'ranking'
  | 'journey'
  | 'sources'
  | 'reviews'
  | 'summary'
  | 'empty';

export function buildSlides(report: RecapReport): SlideKey[] {
  if (report.totals.watchSeconds <= 0) {
    return report.reviews.count > 0 ? ['intro', 'reviews', 'empty'] : ['empty'];
  }
  const slides: SlideKey[] = ['intro', 'time'];
  if (report.months.filter((value) => value > 0).length >= 2)
    slides.push('months');
  if (!report.rhythmHidden) slides.push('hours');
  if (
    !report.rhythmHidden &&
    report.latestNight &&
    isLateNight(report.latestNight.localTime)
  ) {
    slides.push('night');
  }
  if (report.peakDay && report.totals.activeDays >= 2) slides.push('peak');
  if (report.longestStreak && report.longestStreak.days >= 3)
    slides.push('streak');
  if (report.topWorks.length > 0) slides.push('top');
  if (report.topWorks.length >= 3) slides.push('ranking');
  if (
    report.firstWork &&
    report.lastWork &&
    report.firstWork.title !== report.lastWork.title
  ) {
    slides.push('journey');
  }
  if (report.topSources.length >= 2) slides.push('sources');
  if (report.reviews.count > 0) slides.push('reviews');
  slides.push('summary');
  return slides;
}
