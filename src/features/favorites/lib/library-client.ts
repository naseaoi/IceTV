import type {
  FavoriteFilter,
  FavoriteSort,
} from '@/features/favorites/lib/favorite-library';
import type { FavoriteLibraryPage } from '@/features/favorites/lib/library-query';
import type { FavoriteItem } from '@/features/favorites/types';
import { fetchWithAuth } from '@/lib/db.client.internal';
import type { FavoritePageItem } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export interface FavoriteLibraryRequest {
  query: string;
  filter: FavoriteFilter;
  sort: FavoriteSort;
  cursor?: string;
  limit?: number;
}

export async function fetchFavoriteLibraryPage(
  request: FavoriteLibraryRequest,
  signal?: AbortSignal,
): Promise<FavoriteLibraryPage> {
  const params = new URLSearchParams({
    format: 'library',
    q: request.query,
    filter: request.filter,
    sort: request.sort,
  });
  if (request.cursor) params.set('cursor', request.cursor);
  if (request.limit !== undefined) params.set('limit', String(request.limit));
  const response = await fetchWithAuth(`/api/favorites?${params}`, {
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('收藏加载失败，请重试');
  return response.json();
}

export function toFavoriteItem({
  key,
  favorite,
  playRecord,
}: FavoritePageItem): FavoriteItem | null {
  const parsed = parseStorageKey(key);
  if (!parsed) return null;
  return {
    id: parsed.id,
    source: parsed.source,
    title: favorite.title,
    year: favorite.year,
    poster: favorite.cover,
    episodes: favorite.total_episodes,
    source_name: favorite.source_name,
    currentEpisode: playRecord?.index,
    progress:
      playRecord && playRecord.total_time > 0
        ? (playRecord.play_time / playRecord.total_time) * 100
        : 0,
    search_title: favorite.search_title,
    origin: favorite.origin,
  };
}
