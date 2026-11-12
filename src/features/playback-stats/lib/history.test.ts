import {
  formatWatchHistoryProgress,
  getWatchHistoryProgressPercent,
  groupWatchHistoryByDay,
} from '@/features/playback-stats/lib/history';
import type { WatchHistoryEntry } from '@/lib/types';

function createEntry(
  partial: Partial<WatchHistoryEntry> & { id: string },
): WatchHistoryEntry {
  return {
    source: 'source',
    video_id: partial.id,
    title: 'Demo',
    source_name: 'Source',
    cover: '',
    year: '2026',
    episode_index: 1,
    total_episodes: 1,
    position: 0,
    duration: 0,
    first_watched_at: 1000,
    last_watched_at: 1000,
    ...partial,
  };
}

describe('groupWatchHistoryByDay', () => {
  it('按最后观看的本地日期分组并生成相对标签', () => {
    const now = new Date(2026, 10, 3, 20).getTime();
    const groups = groupWatchHistoryByDay(
      [
        createEntry({
          id: 'a',
          last_watched_at: new Date(2026, 10, 3, 9).getTime(),
        }),
        createEntry({
          id: 'b',
          last_watched_at: new Date(2026, 10, 3, 1).getTime(),
        }),
        createEntry({
          id: 'c',
          last_watched_at: new Date(2026, 10, 2, 23).getTime(),
        }),
        createEntry({
          id: 'd',
          last_watched_at: new Date(2026, 9, 28, 12).getTime(),
        }),
        createEntry({
          id: 'e',
          last_watched_at: new Date(2025, 11, 31, 12).getTime(),
        }),
      ],
      now,
    );

    expect(groups.map((group) => group.label)).toEqual([
      '今天',
      '昨天',
      '10月28日',
      '2025年12月31日',
    ]);
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('formatWatchHistoryProgress', () => {
  it('剧集显示集数与观看位置', () => {
    expect(
      formatWatchHistoryProgress(
        createEntry({
          id: 'a',
          episode_index: 3,
          total_episodes: 12,
          position: 724,
        }),
      ),
    ).toBe('第 3 集 · 看到 12:04');
  });

  it('分组源显示组内集数', () => {
    expect(
      formatWatchHistoryProgress(
        createEntry({
          id: 'a',
          episode_index: 15,
          total_episodes: 24,
          group_label: '简中',
          group_index: 3,
          group_total: 12,
          position: 60,
        }),
      ),
    ).toBe('第 3 集 · 看到 01:00');
  });

  it('单集作品只显示观看位置；总集数未知但不在第 1 集时仍显示集数', () => {
    expect(
      formatWatchHistoryProgress(createEntry({ id: 'a', position: 3725 })),
    ).toBe('看到 01:02:05');
    expect(
      formatWatchHistoryProgress(
        createEntry({
          id: 'b',
          episode_index: 2,
          total_episodes: 0,
          position: 5,
        }),
      ),
    ).toBe('第 2 集 · 看到 00:05');
  });
});

describe('getWatchHistoryProgressPercent', () => {
  it('按位置与时长计算，时长未知时为 0', () => {
    expect(
      getWatchHistoryProgressPercent(
        createEntry({ id: 'a', position: 30, duration: 120 }),
      ),
    ).toBe(25);
    expect(
      getWatchHistoryProgressPercent(
        createEntry({ id: 'b', position: 30, duration: 0 }),
      ),
    ).toBe(0);
  });
});
