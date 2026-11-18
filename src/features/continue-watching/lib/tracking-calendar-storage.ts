import type { TrackingCalendarItem } from '@/features/continue-watching/lib/tracking-calendar';
import { favoriteTrackingSql } from '@/features/favorites/lib/favorite-tracking';
import { getPlayRecordEpisodeDisplay } from '@/lib/play-records';
import {
  buildTrackingSql,
  MYSQL_TRACKING_DIALECT,
  SQLITE_TRACKING_DIALECT,
} from '@/lib/tracking-sql';
import type { Favorite, PlayRecord } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export interface TrackingCalendarRow {
  entry_key: string;
  entry_json: string;
  origin: 'record' | 'favorite';
  has_update: number;
}
export function trackingCalendarSql(dialect: 'sqlite' | 'mysql'): string {
  const primitives =
    dialect === 'sqlite' ? SQLITE_TRACKING_DIALECT : MYSQL_TRACKING_DIALECT;
  const tracking = buildTrackingSql(primitives);
  const favorite = favoriteTrackingSql(dialect);
  const text = (column: string, field: string) =>
    dialect === 'sqlite'
      ? `json_extract(${column}, '$.${field}')`
      : `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.${field}')), 'null')`;
  return `SELECT entry_key, entry_json, origin, has_update FROM (
    SELECT record_key AS entry_key, record_json AS entry_json, 'record' AS origin,
      CASE WHEN ${tracking.unreadWhere} THEN 1 ELSE 0 END AS has_update,
      COALESCE(${primitives.jsonTimestamp('save_time')}, 0) AS activity_at
    FROM play_records WHERE username = ? AND ${primitives.trackingEnabled()}
      AND COALESCE(${text('record_json', 'series_status')}, '') <> 'ended'
    UNION ALL
    SELECT f.favorite_key AS entry_key, f.favorite_json AS entry_json, 'favorite' AS origin,
      CASE WHEN ${favorite.unread} THEN 1 ELSE 0 END AS has_update,
      COALESCE(${primitives.jsonTimestamp('save_time').replaceAll('record_json', 'f.favorite_json')}, 0) AS activity_at
    FROM favorites f WHERE f.username = ? AND ${favorite.eligible}
  ) calendar_entries ORDER BY activity_at DESC, entry_key DESC LIMIT 200`;
}
export function trackingCalendarItems(
  rows: TrackingCalendarRow[],
): TrackingCalendarItem[] {
  return rows.flatMap((row) => {
    const parsed = parseStorageKey(row.entry_key);
    if (!parsed) return [];
    const value = JSON.parse(row.entry_json) as PlayRecord | Favorite;
    const progress =
      row.origin === 'record'
        ? getPlayRecordEpisodeDisplay(value as PlayRecord)
        : null;
    const total = progress?.totalEpisodes ?? value.total_episodes;
    const detectedAt = value.update_detected_at;
    return [
      {
        key: row.entry_key,
        source: parsed.source,
        id: parsed.id,
        title: value.title,
        year: value.year,
        cover: value.cover,
        searchTitle: value.search_title ?? '',
        origin: row.origin,
        episodeIndex: progress?.currentEpisode ?? null,
        totalEpisodes: Number.isFinite(total) && total > 0 ? total : null,
        hasUpdate: Number(row.has_update) === 1,
        updateDetectedAt:
          typeof detectedAt === 'number' &&
          Number.isFinite(detectedAt) &&
          detectedAt > 0
            ? detectedAt
            : null,
        airWeekday: null,
      },
    ];
  });
}
