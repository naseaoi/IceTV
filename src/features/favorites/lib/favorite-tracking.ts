import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import type { MessageCursor } from '@/lib/message-cursor.server';
import type { TrackingUpdateUserMessage } from '@/lib/message-types';
import {
  MYSQL_TRACKING_DIALECT,
  SQLITE_TRACKING_DIALECT,
} from '@/lib/tracking-sql';
import type { Favorite } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export interface FavoriteMessagePage {
  items: TrackingUpdateUserMessage[];
  total: number;
}

export function buildFavoriteUpdateMessage(
  key: string,
  favorite: Favorite,
): TrackingUpdateUserMessage | null {
  const parsed = parseStorageKey(key);
  const baseline = favorite.update_baseline_episodes;
  const readThrough = Math.max(
    baseline ?? 0,
    Number.isSafeInteger(favorite.update_message_read_episodes)
      ? (favorite.update_message_read_episodes as number)
      : (baseline ?? 0),
  );
  if (
    !parsed ||
    isCatalogFavoriteSource(parsed.source) ||
    (favorite.origin ?? 'vod') !== 'vod' ||
    favorite.tracking_enabled === false ||
    baseline === undefined ||
    !Number.isSafeInteger(baseline) ||
    baseline < 0 ||
    !Number.isSafeInteger(favorite.total_episodes) ||
    favorite.total_episodes <= readThrough ||
    !favorite.update_detected_at
  )
    return null;
  return {
    id: `favorite-tracking:${encodeURIComponent(key)}:${readThrough}:${favorite.total_episodes}`,
    type: 'tracking-update',
    recordKey: key,
    source: parsed.source,
    videoId: parsed.id,
    title: favorite.title,
    year: favorite.year,
    ...(favorite.search_title ? { searchTitle: favorite.search_title } : {}),
    sourceName: favorite.source_name,
    cover: favorite.cover,
    fromEpisodes: readThrough,
    toEpisodes: favorite.total_episodes,
    createdAt: favorite.update_detected_at,
  };
}

export function favoriteTrackingSql(dialect: 'sqlite' | 'mysql') {
  const primitives =
    dialect === 'sqlite' ? SQLITE_TRACKING_DIALECT : MYSQL_TRACKING_DIALECT;
  const number = (field: string) => {
    const type =
      dialect === 'sqlite'
        ? `json_type(f.favorite_json, '$.${field}') IN ('integer', 'real')`
        : `JSON_TYPE(JSON_EXTRACT(f.favorite_json, '$.${field}')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')`;
    const value = primitives
      .jsonReal(field)
      .replaceAll('record_json', 'f.favorite_json');
    return `(CASE WHEN ${type} THEN ${value} END)`;
  };
  const total = number('total_episodes');
  const baseline = number('update_baseline_episodes');
  const messageRead = `COALESCE(${number('update_message_read_episodes')}, ${baseline})`;
  const createdAt = number('update_detected_at');
  const origin =
    dialect === 'sqlite'
      ? "json_extract(f.favorite_json, '$.origin')"
      : "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(f.favorite_json, '$.origin')), 'null')";
  const source =
    dialect === 'sqlite'
      ? "substr(f.favorite_key, 1, instr(f.favorite_key, '+') - 1) COLLATE BINARY"
      : "SUBSTRING_INDEX(f.favorite_key, '+', 1) COLLATE utf8mb4_bin";
  const trackable = `COALESCE(${origin}, 'vod') = 'vod'
    AND ${source} NOT IN ('douban', 'bangumi')`;
  const trackingEnabled =
    dialect === 'sqlite'
      ? "COALESCE(json_extract(f.favorite_json, '$.tracking_enabled'), 1) <> 0"
      : "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(f.favorite_json, '$.tracking_enabled')), 'null'), 'true') <> 'false'";
  const eligible = `f.library_valid = 1
    AND ${trackable} AND ${trackingEnabled}
    AND NOT EXISTS (SELECT 1 FROM play_records p WHERE p.username = f.username AND p.record_key = f.favorite_key)`;
  const updated = `${eligible} AND ${baseline} >= 0 AND ${baseline} = FLOOR(${baseline}) AND ${total} <= 9007199254740991 AND ${total} = FLOOR(${total}) AND ${total} > ${baseline} AND ${createdAt} > 0`;
  return {
    total,
    messageRead,
    updated,
    baseline,
    createdAt,
    eligible,
    trackable,
    unread: `${updated} AND ${total} > ${messageRead}`,
  };
}

export function favoriteMessageQueries(
  dialect: 'sqlite' | 'mysql',
  username: string,
  limit: number,
  before?: MessageCursor | null,
) {
  const { unread, createdAt } = favoriteTrackingSql(dialect);
  const sortKey =
    dialect === 'sqlite'
      ? "('favorite-tracking:' || f.favorite_key)"
      : "CONCAT('favorite-tracking:', f.favorite_key)";
  const where = `FROM favorites f WHERE f.username = ? AND ${unread}`;
  return {
    count: `SELECT COUNT(*) AS count ${where}`,
    page: `SELECT f.favorite_key, f.favorite_json ${where}${before ? ` AND (${createdAt} < ? OR (${createdAt} = ? AND ${sortKey} < ?))` : ''} ORDER BY ${createdAt} DESC, f.favorite_key DESC LIMIT ?`,
    params: [
      username,
      ...(before ? [before.createdAt, before.createdAt, before.key] : []),
      limit,
    ],
  };
}

export function favoriteTrackingStatement(dialect: 'sqlite' | 'mysql') {
  const value = dialect === 'sqlite' ? 'json(?)' : 'CAST(? AS JSON)';
  return `UPDATE favorites AS f SET favorite_json = JSON_SET(f.favorite_json, '$.tracking_enabled', ${value})
    WHERE f.username = ? AND f.favorite_key = ? AND ${favoriteTrackingSql(dialect).trackable}`;
}

// 只推进消息水位，保留更新基线与并发刷新发现的新集数。
export function favoriteReadStatement(dialect: 'sqlite' | 'mysql') {
  const { total, messageRead, unread } = favoriteTrackingSql(dialect);
  const value = dialect === 'mysql' ? 'CAST(? AS SIGNED)' : '?';
  return `UPDATE favorites AS f SET favorite_json = JSON_SET(f.favorite_json, '$.update_message_read_episodes', CASE WHEN ${total} < ${value} THEN ${dialect === 'mysql' ? `CAST(${total} AS SIGNED)` : total} ELSE ${value} END)
    WHERE f.username = ? AND f.favorite_key = ? AND ${unread} AND ${messageRead} < ?`;
}

export function favoriteMessagesFromRows(
  rows: { favorite_key: string; favorite_json: string }[],
) {
  return rows.flatMap((row) => {
    const message = buildFavoriteUpdateMessage(
      row.favorite_key,
      JSON.parse(row.favorite_json),
    );
    return message ? [message] : [];
  });
}
