import { playbackWorkIdentity } from './work-identity';

export type PlaybackSourceUsage = {
  source: string;
  sourceName: string;
  watchSeconds: number;
  userCount: number;
  workCount: number;
};

export type PlaybackSourceUsageRow = {
  username: string;
  source: string;
  source_name: string;
  title: string;
  year: string;
  watch_seconds: number;
  started_at: number;
};

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

export function sourceUsageSql(personal: boolean): string {
  return `SELECT username, source, source_name, title, year, watch_seconds, started_at
    FROM playback_sessions WHERE ${personal ? 'username = ? AND ' : ''}started_at >= ? AND started_at < ? AND watch_seconds > 0`;
}
