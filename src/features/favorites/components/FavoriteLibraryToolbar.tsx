'use client';

import type { ReactNode } from 'react';

import { LibraryToolbar } from '@/components/LibraryToolbar';
import type {
  FavoriteFilter,
  FavoriteFilterCounts,
  FavoriteSort,
} from '@/features/favorites/lib/favorite-library';

const FILTER_OPTIONS: { value: FavoriteFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'planned', label: '想看' },
  { value: 'watching', label: '在看' },
  { value: 'completed', label: '看过' },
  { value: 'reviewed', label: '已评价' },
];

const SORT_OPTIONS: { value: FavoriteSort; label: string }[] = [
  { value: 'saved', label: '最近收藏' },
  { value: 'played', label: '最近观看' },
  { value: 'watched', label: '看过时间' },
  { value: 'rating', label: '我的评分' },
  { value: 'year', label: '上映年份' },
];

export const EMPTY_FAVORITE_COUNTS: FavoriteFilterCounts = {
  all: 0,
  planned: 0,
  watching: 0,
  completed: 0,
  reviewed: 0,
};

interface FavoriteLibraryToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  filter: FavoriteFilter;
  onFilterChange: (value: FavoriteFilter) => void;
  sort: FavoriteSort;
  onSortChange: (value: FavoriteSort) => void;
  counts: FavoriteFilterCounts;
  loading?: boolean;
  action?: ReactNode;
}

export function FavoriteLibraryToolbar({
  counts,
  ...props
}: FavoriteLibraryToolbarProps) {
  return (
    <LibraryToolbar
      {...props}
      searchLabel='搜索收藏'
      countsKey='favorites'
      filterOptions={FILTER_OPTIONS.map((option) => ({
        ...option,
        count: counts[option.value],
      }))}
      sortOptions={SORT_OPTIONS}
    />
  );
}
