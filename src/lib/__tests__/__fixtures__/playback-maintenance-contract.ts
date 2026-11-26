import type { PlaybackSourceUsage } from '@/features/playback-stats/lib/source-usage';
import { playbackWorkIdentity } from '@/features/playback-stats/lib/work-identity';
import type { IStorage, PlaybackSession } from '@/lib/types';

export type PlaybackSourceUsageRow = Pick<
  PlaybackSession,
  'source' | 'source_name' | 'title' | 'year' | 'watch_seconds' | 'started_at'
> & { username: string };

// SQL 下推前的参考实现，只用于口径对比与性能基线。
export function aggregateSourceUsage(
  rows: PlaybackSourceUsageRow[],
): PlaybackSourceUsage[] {
  const sources = new Map<
    string,
    {
      item: PlaybackSourceUsage;
      last: number;
      users: Set<string>;
      works: Set<string>;
    }
  >();
  for (const row of rows) {
    if (!(Number(row.watch_seconds) > 0)) continue;
    let source = sources.get(row.source);
    if (!source) {
      source = {
        item: {
          source: row.source,
          sourceName: row.source_name,
          watchSeconds: 0,
          userCount: 0,
          workCount: 0,
        },
        last: -Infinity,
        users: new Set(),
        works: new Set(),
      };
      sources.set(row.source, source);
    }
    source.item.watchSeconds += Number(row.watch_seconds);
    source.users.add(row.username);
    source.works.add(playbackWorkIdentity(row));
    if (Number(row.started_at) >= source.last) {
      source.last = Number(row.started_at);
      source.item.sourceName = row.source_name;
    }
  }
  return [...sources.values()]
    .map(({ item, users, works }) => ({
      ...item,
      userCount: users.size,
      workCount: works.size,
    }))
    .sort(
      (a, b) =>
        b.watchSeconds - a.watchSeconds || a.source.localeCompare(b.source),
    );
}

export const maintenanceSession: PlaybackSession = {
  id: 'maintenance-session',
  source: 'maintenance-source',
  video_id: 'one',
  episode_index: 1,
  title: 'Show',
  source_name: 'Source',
  cover: '',
  year: '2026',
  started_at: 900000,
  ended_at: 960000,
  watch_seconds: 20,
  last_position: 20,
  total_time: 100,
  created_at: 900000,
  updated_at: 960000,
};

export async function assertSourceUsageAggregation(storage: IStorage) {
  const rows = Array.from({ length: 36 }, (_, index) => ({
    ...maintenanceSession,
    id: `maintenance-usage-${index}`,
    username: `maintenance-user-${index % 3}`,
    source: ['source', 'Source', 'source '][index % 3],
    title: ['Show', ' SHOW ', 'show', 'Shów', 'Other', 'Show'][index % 6],
    year: ['2026', ' 2026 ', '', 'unknown'][index % 4],
    source_name: `Source ${index}`,
    started_at: 900000 + index,
    watch_seconds: index % 7 ? index : 0,
  }));
  try {
    for (const row of rows) await storage.setPlaybackSession(row.username, row);
    for (const username of [undefined, 'maintenance-user-1']) {
      const selected = rows.filter(
        (row) =>
          row.started_at < 900035 &&
          (username === undefined || row.username === username),
      );
      expect(
        await storage.getPlaybackSourceUsage(900000, 900035, username),
      ).toEqual(aggregateSourceUsage(selected));
    }
    expect(await storage.getPlaybackSourceUsage(900000, 900000)).toEqual([]);
  } finally {
    for (let index = 0; index < 3; index++)
      await storage.deleteUser(`maintenance-user-${index}`);
  }
}

export async function assertPlaybackRetentionBatches(storage: IStorage) {
  const username = 'maintenance-retention';
  try {
    for (let index = 0; index < 503; index++) {
      await storage.saveWatchSessionReport(
        username,
        {
          ...maintenanceSession,
          id: `maintenance-retention-${index}`,
          updated_at: index === 502 ? 970000 : 960000,
        },
        [{ start: 900000, watch_ms: 3000 }],
      );
    }
    expect(
      await storage.deletePlaybackSessionsBefore(970000),
    ).toBeGreaterThanOrEqual(502);
    expect(
      await storage.getPlaybackPeriodSessions(username, 0, 1000000),
    ).toHaveLength(1);
    // 同 ID 重建仅累计新桶，证明跨批次的旧桶与会话一起删除。
    for (const index of [0, 500]) {
      await storage.saveWatchSessionReport(
        username,
        {
          ...maintenanceSession,
          id: `maintenance-retention-${index}`,
        },
        [{ start: 900000, watch_ms: 1000 }],
      );
    }
    expect(
      (await storage.getPlaybackPeriodSessions(username, 0, 1000000)).reduce(
        (sum, row) => sum + Number(row.watch_seconds),
        0,
      ),
    ).toBe(5);
    expect(
      await storage.deletePlaybackSessionsBefore(970001),
    ).toBeGreaterThanOrEqual(3);
    expect(
      await storage.getPlaybackPeriodSessions(username, 0, 1000000),
    ).toEqual([]);
  } finally {
    await storage.deleteUser(username);
  }
}
