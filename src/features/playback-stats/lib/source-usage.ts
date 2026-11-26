import { playbackWorkIdentity } from './work-identity';

export type PlaybackSourceUsage = {
  source: string;
  sourceName: string;
  watchSeconds: number;
  userCount: number;
  workCount: number;
};

export type AggregatedSourceUsageRow = {
  source: string;
  source_name: string;
  watch_seconds: number;
  user_count: number;
  title: string;
  year: string;
};

export function sourceUsageFromAggregates(
  rows: AggregatedSourceUsageRow[],
): PlaybackSourceUsage[] {
  const sources = new Map<
    string,
    { item: PlaybackSourceUsage; works: Set<string> }
  >();
  for (const raw of rows) {
    const row = {
      ...raw,
      source: String(raw.source),
      title: String(raw.title),
      year: String(raw.year),
    };
    let source = sources.get(row.source);
    if (!source) {
      source = {
        item: {
          source: row.source,
          sourceName: row.source_name,
          watchSeconds: Number(row.watch_seconds),
          userCount: Number(row.user_count),
          workCount: 0,
        },
        works: new Set(),
      };
      sources.set(row.source, source);
    }
    source.works.add(playbackWorkIdentity(row));
  }
  return [...sources.values()]
    .map(({ item, works }) => ({ ...item, workCount: works.size }))
    .sort(
      (a, b) =>
        b.watchSeconds - a.watchSeconds || a.source.localeCompare(b.source),
    );
}

export function sourceUsageSql(
  personal: boolean,
  dialect: 'sqlite' | 'mysql',
): string {
  // MySQL 原表使用 unicode_ci；分组必须逐字匹配，归一化仅由作品身份函数负责。
  const exact = (column: string) =>
    dialect === 'mysql' ? `CAST(${column} AS BINARY)` : column;
  return `WITH filtered AS (
    SELECT id, ${exact('username')} AS username, ${exact('source')} AS source,
      source_name, ${exact('title')} AS title, ${exact('year')} AS year,
      watch_seconds, started_at
    FROM playback_sessions
    WHERE ${personal ? 'username = ? AND ' : ''}started_at >= ? AND started_at < ? AND watch_seconds > 0
  ), totals AS (
    SELECT source, SUM(watch_seconds) AS watch_seconds,
      COUNT(DISTINCT username) AS user_count, MAX(started_at) AS last_started
    FROM filtered GROUP BY source
  ), latest AS (
    SELECT f.source, MAX(f.id) AS id FROM filtered f
    JOIN totals t ON t.source = f.source AND t.last_started = f.started_at
    GROUP BY f.source
  ), works AS (
    SELECT source, title, year FROM filtered GROUP BY source, title, year
  )
  SELECT w.source, w.title, w.year, t.watch_seconds, t.user_count, f.source_name
  FROM works w JOIN totals t ON t.source = w.source
  JOIN latest l ON l.source = w.source JOIN filtered f ON f.id = l.id`;
}
