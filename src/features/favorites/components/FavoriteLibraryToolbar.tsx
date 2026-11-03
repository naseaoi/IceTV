'use client';

import { ArrowUpDown, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import Select from '@/components/Select';
import type {
  FavoriteFilter,
  FavoriteFilterCounts,
  FavoriteSort,
} from '@/features/favorites/lib/favorite-library';

const FILTER_OPTIONS: { value: FavoriteFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'watched', label: '看过' },
  { value: 'unwatched', label: '未看' },
  { value: 'reviewed', label: '已评价' },
];

const SORT_OPTIONS: { value: FavoriteSort; label: string }[] = [
  { value: 'saved', label: '最近收藏' },
  { value: 'played', label: '最近观看' },
  { value: 'rating', label: '我的评分' },
  { value: 'year', label: '上映年份' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

interface FavoriteLibraryToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  filter: FavoriteFilter;
  onFilterChange: (value: FavoriteFilter) => void;
  sort: FavoriteSort;
  onSortChange: (value: FavoriteSort) => void;
  counts: FavoriteFilterCounts;
  // 加载期间计数用占位块，避免 0 跳到真实值时胶囊宽度抖动
  loading?: boolean;
}

export function FavoriteLibraryToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  counts,
  loading = false,
}: FavoriteLibraryToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4'>
      <label className='group relative flex h-10 items-center rounded-xl bg-white/75 shadow-sm ring-1 ring-inset ring-black/[0.06] backdrop-blur transition focus-within:bg-white focus-within:ring-green-500/50 dark:bg-white/[0.06] dark:shadow-none dark:ring-white/[0.06] dark:focus-within:bg-gray-900 lg:w-80'>
        <Search
          aria-hidden='true'
          className='pointer-events-none absolute left-3 h-4 w-4 text-gray-400 transition group-focus-within:text-green-500'
        />
        <input
          ref={inputRef}
          type='search'
          aria-label='搜索收藏'
          placeholder='搜索收藏'
          value={query}
          autoComplete='off'
          enterKeyHint='search'
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            if (query) onQueryChange('');
            else event.currentTarget.blur();
          }}
          className='h-full w-full border-0 bg-transparent py-0 pl-9 pr-10 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0 dark:text-gray-100 [&::-webkit-search-cancel-button]:hidden'
        />
        {query ? (
          <button
            type='button'
            aria-label='清除搜索'
            onClick={() => {
              onQueryChange('');
              inputRef.current?.focus();
            }}
            className='absolute right-2 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200'
          >
            <X aria-hidden='true' className='h-3.5 w-3.5' />
          </button>
        ) : (
          <kbd className='pointer-events-none absolute right-2.5 hidden h-5 min-w-5 items-center justify-center rounded-md border border-gray-200 bg-white px-1.5 font-sans text-[11px] text-gray-400 dark:border-white/10 dark:bg-white/5 sm:flex'>
            /
          </kbd>
        )}
      </label>

      <div className='flex min-w-0 flex-1 items-center gap-3'>
        <div
          role='group'
          aria-label='筛选'
          className='-mx-2 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        >
          {FILTER_OPTIONS.map((option) => {
            const active = option.value === filter;
            return (
              <button
                key={option.value}
                type='button'
                aria-pressed={active}
                onClick={() => onFilterChange(option.value)}
                className={`inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-medium transition ${
                  active
                    ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900'
                    : 'bg-white/75 text-gray-600 ring-1 ring-inset ring-black/[0.06] hover:bg-white hover:text-gray-900 dark:bg-white/[0.06] dark:text-gray-300 dark:ring-white/[0.06] dark:hover:bg-white/10 dark:hover:text-white'
                }`}
              >
                {option.label}
                {loading ? (
                  <span
                    aria-hidden='true'
                    className='ml-1.5 h-2.5 w-3 animate-pulse rounded-sm bg-current opacity-20'
                  />
                ) : (
                  <span className='ml-1.5 tabular-nums opacity-55'>
                    {counts[option.value]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Select
          variant='pill'
          align='end'
          icon={ArrowUpDown}
          ariaLabel='排序'
          value={sort}
          onChange={(value) => onSortChange(value as FavoriteSort)}
          options={SORT_OPTIONS}
          className='shrink-0'
        />
      </div>
    </div>
  );
}
