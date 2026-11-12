import type { AnnualReport } from '@/features/playback-stats/types';

import {
  buildSlides,
  daypartOfHour,
  dominantDaypart,
  formatClock,
  formatDuration,
  formatDurationShort,
  isLateNight,
  watchComparison,
} from './format';

function hoursWith(values: Record<number, number>): number[] {
  return Array.from({ length: 24 }, (_, hour) => values[hour] ?? 0);
}

function report(changes: Partial<AnnualReport> = {}): AnnualReport {
  const work = {
    title: 'A',
    year: '2025',
    cover: '',
    source: 's',
    videoId: '1',
    watchSeconds: 3600,
    episodeCount: 1,
    firstWatchedAt: 0,
    lastWatchedAt: 0,
  };
  return {
    year: 2025,
    timeZone: 'Asia/Shanghai',
    generatedAt: 0,
    inProgress: false,
    availableYears: [2025],
    possiblyIncomplete: false,
    totals: {
      watchSeconds: 3600,
      estimatedWatchSeconds: 0,
      activeDays: 1,
      workCount: 1,
      episodeCount: 1,
      sourceCount: 1,
    },
    months: Array.from({ length: 12 }, (_, index) => (index === 0 ? 3600 : 0)),
    hours: hoursWith({ 20: 3600 }),
    weekdays: [3600, 0, 0, 0, 0, 0, 0],
    lateNightWatchSeconds: 0,
    latestNight: null,
    peakDay: null,
    longestStreak: null,
    topWorks: [work],
    topSources: [],
    firstWork: null,
    lastWork: null,
    reviews: { count: 0, ratedCount: 0, averageRating: null, topRated: null },
    ...changes,
  };
}

describe('annual report format', () => {
  it('formats durations for headlines and lists', () => {
    expect(formatDuration(30)).toBe('不到 1 分钟');
    expect(formatDuration(45 * 60)).toBe('45 分钟');
    expect(formatDuration(2 * 3600)).toBe('2 小时');
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe('2 小时 5 分钟');
    expect(formatDurationShort(12 * 3600 + 30 * 60)).toBe('12 小时');
    expect(formatDurationShort(3600 + 30 * 60)).toBe('1 小时 30 分');
  });

  it('treats 23:00 through 04:59 as late night', () => {
    expect(isLateNight('23:00')).toBe(true);
    expect(isLateNight('04:59')).toBe(true);
    expect(isLateNight('05:00')).toBe(false);
    expect(isLateNight('22:59')).toBe(false);
    expect(formatClock('04:05')).toBe('凌晨 4:05');
    expect(formatClock('21:30')).toBe('晚上 21:30');
  });

  it('maps every hour to exactly one daypart, including across midnight', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(daypartOfHour(hour)).toBeDefined();
    }
    expect(daypartOfHour(2).key).toBe('night');
    expect(daypartOfHour(23).key).toBe('night');
  });

  it('compares dayparts by hourly average rather than total', () => {
    // 午休 2 小时各 100，晚间 5 小时各 50：总量晚间多，均值午休高
    const hours = hoursWith({
      12: 100,
      13: 100,
      18: 50,
      19: 50,
      20: 50,
      21: 50,
      22: 50,
    });
    expect(dominantDaypart(hours)?.key).toBe('noon');
    expect(dominantDaypart(hoursWith({}))).toBeNull();
  });

  it('picks a comparison by scale', () => {
    expect(watchComparison(3 * 86_400)).toBe('相当于不眠不休看了 3.0 天');
    expect(watchComparison(6 * 3600)).toBe('差不多是 3 部电影的长度');
    expect(watchComparison(1800)).toBeNull();
  });

  it('shows only the empty slide when nothing was watched', () => {
    const empty = report({
      totals: { ...report().totals, watchSeconds: 0 },
    });
    expect(buildSlides(empty)).toEqual(['empty']);
    expect(
      buildSlides({
        ...empty,
        reviews: {
          count: 1,
          ratedCount: 0,
          averageRating: null,
          topRated: null,
        },
      }),
    ).toEqual(['intro', 'reviews', 'empty']);
  });

  it('skips slides whose data is too thin to tell a story', () => {
    const slides = buildSlides(
      report({
        latestNight: {
          title: 'A',
          year: '2025',
          cover: '',
          source: 's',
          videoId: '1',
          at: 0,
          localTime: '22:30',
        },
        longestStreak: {
          days: 2,
          startDate: '2025-01-01',
          endDate: '2025-01-02',
        },
      }),
    );
    expect(slides).toEqual(['intro', 'time', 'hours', 'top', 'summary']);
  });

  it('includes optional slides once their thresholds are met', () => {
    const slides = buildSlides(
      report({
        totals: { ...report().totals, activeDays: 5 },
        months: Array.from({ length: 12 }, (_, index) =>
          index < 2 ? 1800 : 0,
        ),
        latestNight: {
          title: 'A',
          year: '2025',
          cover: '',
          source: 's',
          videoId: '1',
          at: 0,
          localTime: '01:30',
        },
        peakDay: { date: '2025-01-03', watchSeconds: 1800, works: [] },
        longestStreak: {
          days: 3,
          startDate: '2025-01-01',
          endDate: '2025-01-03',
        },
      }),
    );
    expect(slides).toEqual(
      expect.arrayContaining(['months', 'night', 'peak', 'streak']),
    );
  });
});
