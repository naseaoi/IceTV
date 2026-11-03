import {
  buildFavoriteLibrary,
  countFavoriteFilters,
  selectFavoriteEntries,
} from '@/features/favorites/lib/favorite-library';
import type { Favorite, PlayRecord, VideoReview } from '@/lib/types';

function favorite(title: string, year: string, saveTime: number): Favorite {
  return {
    title,
    year,
    cover: '',
    source_name: '源',
    total_episodes: 12,
    save_time: saveTime,
  };
}

function review(
  title_norm: string,
  year: string,
  rating: number | null,
): VideoReview {
  return {
    title_norm,
    year,
    title: title_norm,
    cover: '',
    douban_id: 0,
    rating,
    content: '',
    is_public: false,
    source_key: '',
    created_at: 1,
    updated_at: 1,
  };
}

const playRecord = { save_time: 500, index: 3 } as PlayRecord;

const favorites: Record<string, Favorite> = {
  'a+1': favorite('三体', '2023', 300),
  'b+2': favorite('Spy × Family', '2022', 200),
  'c+3': favorite('流浪地球', '', 100),
  'd+4': favorite('三体', '2024', 400),
};

describe('favorite-library', () => {
  const entries = buildFavoriteLibrary(favorites, { 'c+3': playRecord }, [
    review('三体', '2023', 8.6),
    review('spy×family', '', 7),
  ]);

  it('matches reviews by work identity with empty-year wildcard', () => {
    const ratings = Object.fromEntries(
      entries.map((entry) => [
        `${entry.item.source}+${entry.item.id}`,
        entry.item.myRating,
      ]),
    );
    expect(ratings).toEqual({
      'a+1': 8.6,
      'b+2': 7,
      'c+3': undefined,
      'd+4': undefined,
    });
  });

  it('counts filters within the current search', () => {
    expect(countFavoriteFilters(entries, '')).toEqual({
      all: 4,
      watched: 1,
      unwatched: 3,
      reviewed: 2,
    });
    expect(countFavoriteFilters(entries, ' 三 体 ').all).toBe(2);
  });

  it('searches with normalized titles and sorts with missing values last', () => {
    const titles = (
      query: string,
      sort: 'saved' | 'rating' | 'year' | 'played',
    ) =>
      selectFavoriteEntries(entries, { query, filter: 'all', sort }).map(
        (entry) => `${entry.item.source}`,
      );

    expect(titles('SPY', 'saved')).toEqual(['b']);
    expect(titles('', 'saved')).toEqual(['d', 'a', 'b', 'c']);
    expect(titles('', 'rating')).toEqual(['a', 'b', 'd', 'c']);
    expect(titles('', 'year')).toEqual(['d', 'a', 'b', 'c']);
    expect(titles('', 'played')).toEqual(['c', 'd', 'a', 'b']);
  });

  it('filters by watch and review state', () => {
    const sources = (filter: 'watched' | 'unwatched' | 'reviewed') =>
      selectFavoriteEntries(entries, { query: '', filter, sort: 'saved' }).map(
        (entry) => entry.item.source,
      );
    expect(sources('watched')).toEqual(['c']);
    expect(sources('unwatched')).toEqual(['d', 'a', 'b']);
    expect(sources('reviewed')).toEqual(['a', 'b']);
  });
});
