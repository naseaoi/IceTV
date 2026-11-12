import type {
  FavoriteBatchInput,
  FavoriteWorkQuery,
} from '@/features/favorites/lib/library-query';
import { libraryStatements } from '@/features/favorites/lib/library-storage';
import {
  isCatalogFavoriteSource,
  isFavoriteWatchStatus,
  isWatchedAt,
} from '@/lib/catalog-favorites';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { Favorite } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export class InvalidFavoriteMutation extends Error {}

// 仅服务端携带到合并事务的前置条件；Symbol 不进入收藏 JSON，也不能由客户端伪造。
export const CATALOG_BIND_SNAPSHOT = Symbol('catalog-bind-snapshot');
export class CatalogBindingConflict extends Error {}

export function validateFavoriteBatch(input: unknown): FavoriteBatchInput {
  const fail = () => {
    throw new InvalidFavoriteMutation('收藏操作参数无效');
  };
  if (!input || typeof input !== 'object') return fail();
  const value = input as FavoriteBatchInput;
  if (
    !['set-status', 'remove'].includes(value.action) ||
    !value.target ||
    typeof value.target !== 'object'
  )
    return fail();
  const keysValid = (keys: unknown) =>
    Array.isArray(keys) &&
    keys.length <= 500 &&
    keys.every(
      (key) =>
        typeof key === 'string' && key.length <= 512 && !!parseStorageKey(key),
    );
  if ('keys' in value.target) {
    if (
      !keysValid(value.target.keys) ||
      value.target.keys.length === 0 ||
      'match' in value.target
    )
      return fail();
  } else {
    const { match, exclude } = value.target;
    if (
      !match ||
      typeof match.q !== 'string' ||
      match.q.length > 500 ||
      !['all', 'planned', 'watching', 'completed', 'reviewed'].includes(
        match.filter,
      ) ||
      !keysValid(exclude)
    )
      return fail();
  }
  if (value.action === 'set-status') {
    if (value.watchStatus !== null && !isFavoriteWatchStatus(value.watchStatus))
      return fail();
    if (
      value.watchedAt !== undefined &&
      value.watchedAt !== null &&
      (!isWatchedAt(value.watchedAt) || value.watchStatus !== 'completed')
    )
      return fail();
  }
  return value;
}

export function batchSelection(
  dialect: 'sqlite' | 'mysql',
  username: string,
  input: FavoriteBatchInput,
) {
  validateFavoriteBatch(input);
  const target = input.target;
  const sql = libraryStatements(dialect, username, {
    query: 'match' in target ? target.match.q : '',
    filter: 'match' in target ? target.match.filter : 'all',
    sort: 'saved',
  });
  const keys = 'keys' in target ? target.keys : target.exclude;
  return {
    sql: `${sql.selection}${keys.length ? ` AND f.favorite_key ${'keys' in target ? 'IN' : 'NOT IN'} (${keys.map(() => '?').join(',')})` : ''}`,
    params: [...sql.selectionParams, ...keys],
  };
}

export function applyFavoriteStatus(
  favorite: Favorite,
  input: FavoriteBatchInput,
  now: number,
): Favorite {
  const next = { ...favorite };
  delete next.watch_status;
  delete next.watched_at;
  if (input.watchStatus) next.watch_status = input.watchStatus;
  if (input.watchStatus === 'completed')
    next.watched_at = input.watchedAt ?? now;
  return next;
}

export function workSelection(
  dialect: 'sqlite' | 'mysql',
  username: string,
  work: FavoriteWorkQuery,
) {
  if (
    !parseStorageKey(work.key) ||
    typeof work.title !== 'string' ||
    work.title.length > 500 ||
    typeof work.year !== 'string' ||
    work.year.length > 100
  )
    throw new InvalidFavoriteMutation('作品查询参数无效');
  const sql = libraryStatements(dialect, username, {
    query: '',
    filter: 'all',
    sort: 'saved',
  });
  const year = normalizeWorkYear(work.year);
  return {
    sql: `${sql.selection} AND (f.favorite_key = ? OR (f.title_norm = ? AND (f.year_norm = ? OR f.year_norm = '' OR ? = ''))) ORDER BY CASE WHEN f.favorite_key = ? THEN 0 ELSE 1 END, f.saved_at ASC, f.favorite_key ASC LIMIT 1`,
    params: [
      ...sql.selectionParams,
      work.key,
      normalizeWorkTitle(work.title),
      year,
      year,
      work.key,
    ],
  };
}

export function mergeSelection(
  username: string,
  key: string,
  favorite: Favorite,
) {
  const year = normalizeWorkYear(favorite.year);
  return {
    sql: `SELECT favorite_key, favorite_json FROM favorites WHERE username = ? AND (favorite_key = ? OR (title_norm = ? AND (year_norm = ? OR year_norm = '' OR ? = ''))) ORDER BY saved_at ASC, favorite_key ASC`,
    params: [username, key, normalizeWorkTitle(favorite.title), year, year],
  };
}

export function mergeFavorite(
  key: string,
  favorite: Favorite,
  rows: { favorite_key: string; favorite_json: string }[],
) {
  const binding = (
    favorite as Favorite & {
      [CATALOG_BIND_SNAPSHOT]?: { key: string; snapshot: Favorite };
    }
  )[CATALOG_BIND_SNAPSHOT];
  if (binding) {
    const current = rows.find((row) => row.favorite_key === binding.key);
    if (
      !current ||
      JSON.stringify(JSON.parse(current.favorite_json)) !==
        JSON.stringify(binding.snapshot)
    ) {
      throw new CatalogBindingConflict();
    }
  }
  const catalog = (key: string) =>
    isCatalogFavoriteSource(parseStorageKey(key)?.source ?? '');
  const existing = rows.map((row) => ({
    key: row.favorite_key,
    favorite: JSON.parse(row.favorite_json) as Favorite,
  }));
  const incomingCatalog = catalog(key);
  const real = existing.find((item) => !catalog(item.key));
  const target = incomingCatalog
    ? (real ?? existing.find((item) => item.key === key) ?? existing[0])
    : existing.find((item) => item.key === key);
  const finalKey = incomingCatalog && target ? target.key : key;
  const catalogs = existing.filter((item) => catalog(item.key));
  const merged =
    incomingCatalog && target && target.key !== key
      ? { ...target.favorite }
      : { ...favorite };
  // 通知基线由服务端保留，资料/状态重存不能确认更新；目录换为真实源时重新起算。
  merged.update_baseline_episodes =
    target?.favorite.update_baseline_episodes ??
    target?.favorite.total_episodes ??
    merged.total_episodes;
  merged.update_detected_at = target?.favorite.update_detected_at;
  merged.tracking_enabled = (
    target?.favorite ??
    binding?.snapshot ??
    catalogs[0]?.favorite
  )?.tracking_enabled;
  merged.catalog_origin =
    target?.favorite.catalog_origin ??
    favorite.catalog_origin ??
    catalogs[0]?.favorite.catalog_origin;
  merged.catalog_bind = catalog(finalKey)
    ? target?.favorite.catalog_bind
    : undefined;
  const statusOwner = favorite.watch_status
    ? favorite
    : target?.favorite.watch_status
      ? target.favorite
      : catalogs.find((item) => item.favorite.watch_status)?.favorite;
  if (statusOwner) {
    merged.watch_status = statusOwner.watch_status;
    if (
      statusOwner.watch_status === 'completed' &&
      statusOwner.watched_at !== undefined
    )
      merged.watched_at = statusOwner.watched_at;
    else delete merged.watched_at;
  }
  // 真实源之间保留独立收藏，只吸收同作品目录项。
  merged.save_time = Math.min(
    favorite.save_time,
    merged.save_time,
    ...(target ? [target.favorite.save_time] : []),
    ...catalogs.map((item) => item.favorite.save_time),
  );
  return {
    key: finalKey,
    favorite: merged,
    removeKeys: catalogs
      .filter((item) => item.key !== finalKey)
      .map((item) => item.key),
  };
}
