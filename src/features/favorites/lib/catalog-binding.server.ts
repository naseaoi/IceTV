import 'server-only';

import {
  CATALOG_BIND_SNAPSHOT,
  CatalogBindingConflict,
} from '@/features/favorites/lib/library-mutations';
import type { ActiveUserInfo } from '@/lib/api-auth';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import { db } from '@/lib/db';
import { resolvePlayableSourceForUser } from '@/lib/quick-search.server';
import { parseSeriesStatus } from '@/lib/series-status';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { Favorite } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export type CatalogBindResult = {
  status: 'bound' | 'skipped' | 'failed' | 'not-catalog';
  key: string;
};

export function isCatalogBindingDue(
  key: string,
  favorite: Favorite,
  now: number,
): boolean {
  return (
    isCatalogFavoriteSource(parseStorageKey(key)?.source ?? '') &&
    favorite.origin !== 'live' &&
    favorite.catalog_bind?.status !== 'skipped' &&
    (favorite.catalog_bind?.retry_at ?? 0) <= now
  );
}

export async function bindCatalogFavorite(
  user: ActiveUserInfo,
  key: string,
  signal?: AbortSignal,
): Promise<CatalogBindResult> {
  const parsed = parseStorageKey(key);
  if (!parsed || !isCatalogFavoriteSource(parsed.source))
    return { status: 'not-catalog', key };
  const favorite = await db.getFavorite(
    user.username,
    parsed.source,
    parsed.id,
  );
  if (!favorite || favorite.origin === 'live')
    return { status: 'not-catalog', key };
  const now = Date.now();
  if (!isCatalogBindingDue(key, favorite, now)) {
    return { status: favorite.catalog_bind?.status ?? 'skipped', key };
  }
  const origin = favorite.catalog_origin ?? {
    key,
    title: favorite.title,
    year: favorite.year,
  };
  const recordAttempt = async (
    status: 'skipped' | 'failed',
  ): Promise<CatalogBindResult> => {
    const attempts = Math.min((favorite.catalog_bind?.attempts ?? 0) + 1, 8);
    await db.saveFavoriteIfUnchanged(
      user.username,
      parsed.source,
      parsed.id,
      {
        ...favorite,
        catalog_origin: origin,
        catalog_bind: {
          status,
          attempts,
          ...(status === 'failed'
            ? {
                retry_at:
                  now +
                  Math.min(24 * 60 * 60_000, 30 * 60_000 * 2 ** (attempts - 1)),
              }
            : {}),
        },
      },
      JSON.stringify(favorite),
    );
    return { status, key };
  };
  const year = normalizeWorkYear(favorite.year);
  if (!/^\d{4}$/.test(year)) return recordAttempt('skipped');

  try {
    const { detail } = await resolvePlayableSourceForUser({
      user,
      query: favorite.title,
      year,
      signal,
      requireFullDetail: true,
    });
    if (
      !detail ||
      !detail.id ||
      !detail.source ||
      isCatalogFavoriteSource(detail.source) ||
      !detail.episodes?.length ||
      normalizeWorkYear(detail.year) !== year ||
      normalizeWorkTitle(detail.title) !== normalizeWorkTitle(favorite.title)
    ) {
      return recordAttempt('failed');
    }
    const status =
      detail.series_status ??
      parseSeriesStatus({
        type_name: detail.type_name,
        episodeCount: detail.episodes.length,
      });
    if (status === 'ended') return recordAttempt('skipped');
    if (signal?.aborted) return { status: 'failed', key };

    const next: Favorite & {
      [CATALOG_BIND_SNAPSHOT]: { key: string; snapshot: Favorite };
    } = {
      ...favorite,
      source_name: detail.source_name,
      total_episodes: detail.episodes.length,
      cover: detail.poster || favorite.cover,
      origin: 'vod',
      metadata_checked_at: Date.now(),
      catalog_bind: undefined,
      catalog_origin: origin,
      [CATALOG_BIND_SNAPSHOT]: { key, snapshot: favorite },
    };
    const finalKey = await db.saveFavorite(
      user.username,
      detail.source,
      detail.id,
      next,
    );
    return { status: 'bound', key: finalKey };
  } catch (error) {
    if (error instanceof CatalogBindingConflict || signal?.aborted)
      return { status: 'failed', key };
    console.warn('目录收藏绑定失败', error);
    return recordAttempt('failed');
  }
}

export async function bindDueCatalogFavorites(
  user: ActiveUserInfo,
  signal?: AbortSignal,
): Promise<CatalogBindResult[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  const now = Date.now();
  do {
    const page = await db.getFavoriteLibraryPage(user.username, {
      query: '',
      filter: 'all',
      sort: 'saved',
      cursor,
    });
    for (const { key, favorite } of page.items) {
      if (isCatalogBindingDue(key, favorite, now)) keys.push(key);
      if (keys.length === 2) break;
    }
    cursor = page.nextCursor ?? undefined;
  } while (keys.length < 2 && cursor && !signal?.aborted);
  const results: CatalogBindResult[] = [];
  for (const key of keys) {
    if (signal?.aborted) break;
    results.push(await bindCatalogFavorite(user, key, signal));
  }
  return results;
}
