import {
  type TrackingCalendarItem,
  formatCalendarProgress,
  getTrackingStripStatus,
  isTrackingStripItem,
  sortTrackingStrip,
  toWeekday,
} from './tracking-calendar';

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

describe('isTrackingStripItem', () => {
  it('只收有更新或有可靠播出日的作品，更新发现时间不算排期', () => {
    expect(isTrackingStripItem(item('update', { hasUpdate: true }))).toBe(true);
    expect(isTrackingStripItem(item('airing', { airWeekday: 4 }))).toBe(true);
    expect(isTrackingStripItem(item('detected', { updateDetectedAt: 1 }))).toBe(
      false,
    );
    expect(isTrackingStripItem(item('bad', { airWeekday: 8 }))).toBe(false);
  });
});

describe('sortTrackingStrip', () => {
  it('有更新在前并按发现时间倒序，其余按周一到周日', () => {
    const sorted = sortTrackingStrip([
      item('sun', { airWeekday: 7 }),
      item('old-update', { hasUpdate: true, updateDetectedAt: 1 }),
      item('mon', { airWeekday: 1 }),
      item('new-update', { hasUpdate: true, updateDetectedAt: 2 }),
    ]);
    expect(sorted.map((entry) => entry.key)).toEqual([
      'new-update',
      'old-update',
      'mon',
      'sun',
    ]);
  });
});

describe('getTrackingStripStatus', () => {
  it('有更新优先于播出日', () => {
    expect(
      getTrackingStripStatus(item('a', { hasUpdate: true, airWeekday: 4 }), 4),
    ).toEqual({ tone: 'update', label: '有更新' });
  });

  it('按本地今天给出今天、明天，跨周日回绕', () => {
    expect(getTrackingStripStatus(item('a', { airWeekday: 4 }), 4)?.label).toBe(
      '今天更新',
    );
    expect(getTrackingStripStatus(item('a', { airWeekday: 1 }), 7)?.label).toBe(
      '明天更新',
    );
    expect(getTrackingStripStatus(item('a', { airWeekday: 6 }), 4)?.label).toBe(
      '周六更新',
    );
  });

  it('未知今天时只给星期', () => {
    expect(
      getTrackingStripStatus(item('a', { airWeekday: 4 }), null)?.label,
    ).toBe('周四更新');
    expect(getTrackingStripStatus(item('a'), null)).toBeNull();
  });
});

describe('toWeekday', () => {
  it('周日记为 7', () => {
    expect(toWeekday(new Date(2026, 10, 15, 12))).toBe(7);
    expect(toWeekday(new Date(2026, 10, 12, 12))).toBe(4);
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
