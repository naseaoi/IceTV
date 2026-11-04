import { createHash } from 'crypto';

import type {
  FavoriteLibraryPage,
  FavoriteLibraryQuery,
} from '@/features/favorites/lib/library-query';
import { FAVORITE_RENDER_CHUNK } from '@/lib/favorites-count';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { Favorite, PlayRecord } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export const FAVORITE_PROJECTION_COLUMNS = [
  'title_norm',
  'year_norm',
  'year_number',
  'search_text',
  'saved_at',
  'library_valid',
  'projection_version',
] as const;

export function favoriteProjection(
  key: string,
  json: string,
): (string | number | null)[] {
  let favorite: Favorite;
  try {
    favorite = JSON.parse(json);
    if (
      !favorite ||
      typeof favorite.title !== 'string' ||
      (favorite.year !== undefined && typeof favorite.year !== 'string') ||
      (favorite.search_title !== undefined &&
        typeof favorite.search_title !== 'string') ||
      !Number.isFinite(favorite.save_time) ||
      !parseStorageKey(key)
    )
      throw new Error('Invalid favorite');
  } catch {
    return ['', '', null, '', 0, 0, 1];
  }
  const year = normalizeWorkYear(favorite.year);
  const number = Number.parseInt(year, 10);
  return [
    normalizeWorkTitle(favorite.title),
    year,
    Number.isFinite(number) ? number : null,
    normalizeWorkTitle(`${favorite.title} ${favorite.search_title ?? ''}`),
    favorite.save_time,
    1,
    1,
  ];
}

export class InvalidFavoriteLibraryQuery extends Error {}

type Cursor = {
  binding: string;
  missing: number;
  value: number;
  saved: number;
  key: string;
};
function binding(username: string, query: FavoriteLibraryQuery): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        username,
        normalizeWorkTitle(query.query),
        query.filter,
        query.sort,
      ]),
    )
    .digest('hex');
}

export function validateLibraryQuery(
  query: FavoriteLibraryQuery,
  username: string,
): Cursor | null {
  if (
    typeof query.query !== 'string' ||
    query.query.length > 500 ||
    !['all', 'watched', 'unwatched', 'reviewed'].includes(query.filter) ||
    !['saved', 'played', 'rating', 'year'].includes(query.sort)
  ) {
    throw new InvalidFavoriteLibraryQuery('收藏查询条件无效');
  }
  if (!query.cursor) return null;
  try {
    if (query.cursor.length > 4096) throw new Error();
    const cursor: Cursor = JSON.parse(
      Buffer.from(query.cursor, 'base64url').toString('utf8'),
    );
    if (
      cursor.binding !== binding(username, query) ||
      ![0, 1].includes(cursor.missing) ||
      !Number.isFinite(cursor.value) ||
      !Number.isFinite(cursor.saved) ||
      typeof cursor.key !== 'string' ||
      !parseStorageKey(cursor.key) ||
      (cursor.missing === 1 && cursor.value !== 0)
    )
      throw new Error();
    return cursor;
  } catch {
    throw new InvalidFavoriteLibraryQuery('收藏分页游标已失效，请重新加载');
  }
}

export interface LibraryRow {
  favorite_key: string;
  favorite_json: string;
  record_json: string | null;
  my_rating: number | null;
  sort_value: number;
  sort_missing: number;
  saved_at: number;
}
export interface LibraryCountsRow {
  all_count: number;
  watched: number;
  reviewed: number;
  library_total: number;
}

export function libraryStatements(
  dialect: 'sqlite' | 'mysql',
  username: string,
  query: FavoriteLibraryQuery,
) {
  const cursor = validateLibraryQuery(query, username);
  const numericJson = (column: string, field: string) =>
    dialect === 'sqlite'
      ? `CAST(json_extract(${column}, '$.${field}') AS REAL)`
      : `CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.${field}')), 'null') AS DOUBLE)`;
  // 存在精确年份评价即选它，包括只有正文、rating 为 null 的记录。
  const rating = `CASE WHEN exact_review.username IS NOT NULL THEN ${numericJson('exact_review.review_json', 'rating')} ELSE ${numericJson('fallback_review.review_json', 'rating')} END`;
  const played = numericJson('p.record_json', 'save_time');
  const sort = { saved: 'f.saved_at', played, rating, year: 'f.year_number' }[
    query.sort
  ];
  const value = query.sort === 'saved' ? 'f.saved_at' : `COALESCE(${sort}, 0)`;
  const missing =
    query.sort === 'saved'
      ? '0'
      : `CASE WHEN ${sort} IS NULL THEN 1 ELSE 0 END`;
  const key =
    dialect === 'mysql'
      ? 'BINARY f.favorite_key'
      : 'f.favorite_key COLLATE BINARY';
  const from = `FROM favorites f
    LEFT JOIN play_records p ON p.username = f.username AND p.record_key = f.favorite_key
    LEFT JOIN video_reviews exact_review ON exact_review.username = f.username AND exact_review.title_norm = f.title_norm AND exact_review.year = f.year_norm
    LEFT JOIN video_reviews fallback_review ON fallback_review.username = f.username AND fallback_review.title_norm = f.title_norm AND fallback_review.year = ''`;
  const reviewed =
    '(exact_review.username IS NOT NULL OR fallback_review.username IS NOT NULL)';
  const normalizedQuery = normalizeWorkTitle(query.query);
  // INSTR 是字面包含匹配，% 和 _ 不作为通配符；MySQL 显式按二进制比较。
  const search = normalizedQuery
    ? ` AND INSTR(${dialect === 'mysql' ? 'BINARY f.search_text' : 'f.search_text'}, ?) > 0`
    : '';
  const where = `WHERE f.username = ? AND f.library_valid = 1${search}`;
  const params: (string | number)[] = [
    username,
    ...(normalizedQuery ? [normalizedQuery] : []),
  ];
  const filter = {
    all: '',
    watched: ' AND p.record_key IS NOT NULL',
    unwatched: ' AND p.record_key IS NULL',
    reviewed: ` AND ${reviewed}`,
  }[query.filter];
  const after = cursor
    ? ` AND (${missing} > ? OR (${missing} = ? AND (${value} < ? OR (${value} = ? AND (f.saved_at < ? OR (f.saved_at = ? AND ${key} < ?))))))`
    : '';
  return {
    counts: `SELECT COUNT(*) AS all_count, COALESCE(SUM(CASE WHEN p.record_key IS NOT NULL THEN 1 ELSE 0 END), 0) AS watched,
      COALESCE(SUM(CASE WHEN ${reviewed} THEN 1 ELSE 0 END), 0) AS reviewed,
      (SELECT COUNT(*) FROM favorites WHERE username = ? AND library_valid = 1) AS library_total ${from} ${where}`,
    countParams: [username, ...params],
    page: `SELECT f.favorite_key, f.favorite_json, p.record_json, ${rating} AS my_rating,
      ${value} AS sort_value, ${missing} AS sort_missing, f.saved_at ${from} ${where}${filter}${after}
      ORDER BY ${query.sort === 'saved' ? `f.saved_at DESC, ${key} DESC` : `${missing} ASC, ${value} DESC, f.saved_at DESC, ${key} DESC`} LIMIT ${FAVORITE_RENDER_CHUNK + 1}`,
    pageParams: [
      ...params,
      ...(cursor
        ? [
            cursor.missing,
            cursor.missing,
            cursor.value,
            cursor.value,
            cursor.saved,
            cursor.saved,
            cursor.key,
          ]
        : []),
    ],
  };
}

export function buildLibraryPage(
  username: string,
  query: FavoriteLibraryQuery,
  rows: LibraryRow[],
  countsRow: LibraryCountsRow,
): FavoriteLibraryPage {
  const counts = {
    all: Number(countsRow.all_count),
    watched: Number(countsRow.watched),
    unwatched: Number(countsRow.all_count) - Number(countsRow.watched),
    reviewed: Number(countsRow.reviewed),
  };
  const page = rows.slice(0, FAVORITE_RENDER_CHUNK);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      key: row.favorite_key,
      favorite: JSON.parse(row.favorite_json) as Favorite,
      playRecord: row.record_json
        ? (JSON.parse(row.record_json) as PlayRecord)
        : undefined,
      myRating: row.my_rating === null ? null : Number(row.my_rating),
    })),
    counts,
    total: counts[query.filter],
    libraryTotal: Number(countsRow.library_total),
    nextCursor:
      rows.length > FAVORITE_RENDER_CHUNK && last
        ? Buffer.from(
            JSON.stringify({
              binding: binding(username, query),
              missing: Number(last.sort_missing),
              value: Number(last.sort_value),
              saved: Number(last.saved_at),
              key: last.favorite_key,
            } satisfies Cursor),
          ).toString('base64url')
        : null,
  };
}
