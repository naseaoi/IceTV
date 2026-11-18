import {
  type TrackingCalendarItem,
  formatCalendarProgress,
  getWeekDates,
  groupTrackingCalendar,
  toWeekday,
} from './tracking-calendar';

const DAY_MS = 24 * 60 * 60 * 1000;
// 2026-11-12 是周四，取本地正午避免时区跨日
const NOW = new Date(2026, 10, 12, 12).getTime();

function item(
  key: string,
  patch: Partial<TrackingCalendarItem> = {},
): TrackingCalendarItem {
  return {
    key,
    source: 'src',
    id: key,
    title: key,
    searchTitle: key,
    year: '2026',
    cover: '',
    origin: 'record',
    episodeIndex: 1,
    totalEpisodes: 12,
    hasUpdate: false,
    updateDetectedAt: null,
    airWeekday: null,
    ...patch,
  };
}

describe('groupTrackingCalendar', () => {
  it('Bangumi 播出星期优先于最近更新推测', () => {
    const groups = groupTrackingCalendar(
      [item('a', { airWeekday: 2, updateDetectedAt: NOW - DAY_MS })],
      NOW,
    );
    expect(groups.days[2].map((entry) => entry.key)).toEqual(['a']);
    expect(groups.days[2][0].inferred).toBe(false);
    expect(groups.days[3]).toEqual([]);
  });

  it('推测窗口内按本地星期归档，窗口外进入近期无更新', () => {
    const groups = groupTrackingCalendar(
      [
        item('recent', { updateDetectedAt: NOW - DAY_MS }),
        item('edge', { updateDetectedAt: NOW - 21 * DAY_MS }),
        item('stale', { updateDetectedAt: NOW - 22 * DAY_MS }),
        item('never'),
        item('future', { updateDetectedAt: NOW + DAY_MS }),
      ],
      NOW,
    );
    expect(groups.days[3].map((entry) => entry.key)).toEqual(['recent']);
    expect(groups.days[3][0].inferred).toBe(true);
    expect(groups.days[4].map((entry) => entry.key)).toEqual(['edge']);
    expect(groups.unscheduled.map((entry) => entry.key).sort()).toEqual([
      'future',
      'never',
      'stale',
    ]);
  });

  it('非法播出星期按无日历处理', () => {
    const groups = groupTrackingCalendar([item('bad', { airWeekday: 8 })], NOW);
    expect(groups.unscheduled.map((entry) => entry.key)).toEqual(['bad']);
  });

  it('同一天内有更新的排前，其次按发现更新时间倒序', () => {
    const groups = groupTrackingCalendar(
      [
        item('old', { airWeekday: 1, updateDetectedAt: NOW - 3 * DAY_MS }),
        item('new', { airWeekday: 1, updateDetectedAt: NOW - DAY_MS }),
        item('updated', {
          airWeekday: 1,
          hasUpdate: true,
          updateDetectedAt: NOW - 5 * DAY_MS,
        }),
      ],
      NOW,
    );
    expect(groups.days[1].map((entry) => entry.key)).toEqual([
      'updated',
      'new',
      'old',
    ]);
  });
});

describe('getWeekDates', () => {
  it('从本周一排到周日', () => {
    const dates = getWeekDates(new Date(NOW));
    expect(dates[1].getDate()).toBe(9);
    expect(dates[4].getDate()).toBe(12);
    expect(dates[7].getDate()).toBe(15);
    expect(toWeekday(dates[7])).toBe(7);
  });
});

describe('formatCalendarProgress', () => {
  it('区分观看进度与仅收藏', () => {
    expect(formatCalendarProgress(item('a'))).toBe('看到 1/12 集');
    expect(
      formatCalendarProgress(
        item('b', { episodeIndex: 3, totalEpisodes: null }),
      ),
    ).toBe('看到第 3 集');
    expect(
      formatCalendarProgress(
        item('c', { origin: 'favorite', episodeIndex: null }),
      ),
    ).toBe('共 12 集');
  });
});
