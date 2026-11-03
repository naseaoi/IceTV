import type { FavoriteItem } from '@/features/favorites/types';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { Favorite, PlayRecord, VideoReview } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export type FavoriteFilter = 'all' | 'watched' | 'unwatched' | 'reviewed';
export type FavoriteSort = 'saved' | 'played' | 'rating' | 'year';

export interface FavoriteLibraryEntry {
  item: FavoriteItem;
  searchText: string;
  savedAt: number;
  playedAt: number | null;
  review: VideoReview | null;
}

export type FavoriteFilterCounts = Record<FavoriteFilter, number>;

type ReviewIndex = Map<string, VideoReview[]>;

function indexReviews(reviews: VideoReview[]): ReviewIndex {
  const index: ReviewIndex = new Map();
  for (const review of reviews) {
    const bucket = index.get(review.title_norm);
    if (bucket) bucket.push(review);
    else index.set(review.title_norm, [review]);
  }
  return index;
}

// 与服务端 `year IN (?, '')` 一致：精确年份优先，空年份评价作通配
function findReview(
  index: ReviewIndex,
  title: string,
  year: string | undefined,
): VideoReview | null {
  const bucket = index.get(normalizeWorkTitle(title));
  if (!bucket) return null;
  const normalizedYear = normalizeWorkYear(year);
  return (
    bucket.find((review) => review.year === normalizedYear) ??
    bucket.find((review) => review.year === '') ??
    null
  );
}

export function buildFavoriteLibrary(
  favorites: Record<string, Favorite>,
  playRecords: Record<string, PlayRecord>,
  reviews: VideoReview[],
): FavoriteLibraryEntry[] {
  const reviewIndex = indexReviews(reviews);

  return Object.entries(favorites).flatMap(([key, favorite]) => {
    const parsedKey = parseStorageKey(key);
    if (!parsedKey) return [];
    const playRecord = playRecords[key];
    const review = findReview(reviewIndex, favorite.title, favorite.year);

    const item: FavoriteItem = {
      id: parsedKey.id,
      source: parsedKey.source,
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
      myRating: review?.rating ?? undefined,
    };

    return [
      {
        item,
        searchText: normalizeWorkTitle(
          `${favorite.title} ${favorite.search_title ?? ''}`,
        ),
        savedAt: favorite.save_time,
        playedAt: playRecord?.save_time ?? null,
        review,
      },
    ];
  });
}

function matchesFilter(
  entry: FavoriteLibraryEntry,
  filter: FavoriteFilter,
): boolean {
  switch (filter) {
    case 'watched':
      return entry.playedAt !== null;
    case 'unwatched':
      return entry.playedAt === null;
    case 'reviewed':
      return entry.review !== null;
    default:
      return true;
  }
}

function matchesQuery(entry: FavoriteLibraryEntry, query: string): boolean {
  return !query || entry.searchText.includes(query);
}

function yearValue(entry: FavoriteLibraryEntry): number | null {
  const year = Number.parseInt(normalizeWorkYear(entry.item.year), 10);
  return Number.isFinite(year) ? year : null;
}

// 缺值沉底
function compareDesc(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function sortValue(
  entry: FavoriteLibraryEntry,
  sort: FavoriteSort,
): number | null {
  switch (sort) {
    case 'played':
      return entry.playedAt;
    case 'rating':
      return entry.item.myRating ?? null;
    case 'year':
      return yearValue(entry);
    default:
      return entry.savedAt;
  }
}

export function countFavoriteFilters(
  entries: FavoriteLibraryEntry[],
  query: string,
): FavoriteFilterCounts {
  const normalizedQuery = normalizeWorkTitle(query);
  const counts: FavoriteFilterCounts = {
    all: 0,
    watched: 0,
    unwatched: 0,
    reviewed: 0,
  };
  for (const entry of entries) {
    if (!matchesQuery(entry, normalizedQuery)) continue;
    counts.all += 1;
    if (entry.playedAt !== null) counts.watched += 1;
    else counts.unwatched += 1;
    if (entry.review) counts.reviewed += 1;
  }
  return counts;
}

export function selectFavoriteEntries(
  entries: FavoriteLibraryEntry[],
  options: { query: string; filter: FavoriteFilter; sort: FavoriteSort },
): FavoriteLibraryEntry[] {
  const normalizedQuery = normalizeWorkTitle(options.query);
  return entries
    .filter(
      (entry) =>
        matchesQuery(entry, normalizedQuery) &&
        matchesFilter(entry, options.filter),
    )
    .sort(
      (left, right) =>
        compareDesc(
          sortValue(left, options.sort),
          sortValue(right, options.sort),
        ) || right.savedAt - left.savedAt,
    );
}
