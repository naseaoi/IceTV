'use client';

import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  SlidersHorizontal,
} from 'lucide-react';
import { useState } from 'react';

import MobileFilterSheet from '@/components/mobile/MobileFilterSheet';
import MobileSheet from '@/components/mobile/MobileSheet';
import type { SearchFilterCategory } from '@/components/SearchResultFilter';

type FilterValues = Record<string, string>;

const SORT_OPTIONS = [
  { value: 'none', label: '默认排序', icon: ArrowUpDown },
  { value: 'desc', label: '年份从新到旧', icon: ArrowDownWideNarrow },
  { value: 'asc', label: '年份从旧到新', icon: ArrowUpNarrowWide },
];

interface MobileSearchFilterControlsProps {
  resultCount: number;
  categories: SearchFilterCategory[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  aggregate: boolean;
  onAggregateChange: (aggregate: boolean) => void;
}

export default function MobileSearchFilterControls({
  resultCount,
  categories,
  values,
  onChange,
  aggregate,
  onAggregateChange,
}: MobileSearchFilterControlsProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const yearOrder = values.yearOrder || 'none';
  const filterCategories = categories.filter((c) => c.key !== 'yearOrder');
  const hasActiveFilter = filterCategories.some(
    (c) => values[c.key] && values[c.key] !== 'all',
  );

  const buttonClass = (active: boolean) =>
    `flex h-8 items-center gap-1 rounded-full border px-3 text-xs ${
      active
        ? 'border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400'
        : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
    }`;

  return (
    <>
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-sm text-gray-500 dark:text-gray-400'>
          {resultCount} 个结果
        </span>
        <div className='flex shrink-0 items-center gap-2'>
          <button
            type='button'
            className={buttonClass(hasActiveFilter)}
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal className='h-3.5 w-3.5' />
            筛选
          </button>
          <button
            type='button'
            className={buttonClass(yearOrder !== 'none')}
            onClick={() => setSortOpen(true)}
          >
            {yearOrder === 'asc' ? (
              <ArrowUpNarrowWide className='h-3.5 w-3.5' />
            ) : yearOrder === 'desc' ? (
              <ArrowDownWideNarrow className='h-3.5 w-3.5' />
            ) : (
              <ArrowUpDown className='h-3.5 w-3.5' />
            )}
            排序
          </button>
        </div>
      </div>

      <MobileFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)}>
        <div className='space-y-5'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium text-gray-800 dark:text-gray-200'>
              聚合相同结果
            </span>
            <label className='relative inline-flex cursor-pointer items-center'>
              <input
                type='checkbox'
                className='peer sr-only'
                checked={aggregate}
                onChange={() => onAggregateChange(!aggregate)}
              />
              <div className='h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
              <div className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4'></div>
            </label>
          </div>

          {filterCategories.map((category) => (
            <div key={category.key}>
              <p className='mb-2 text-sm font-medium text-gray-800 dark:text-gray-200'>
                {category.label}
              </p>
              <div className='flex flex-wrap gap-2'>
                {category.options.map((option) => {
                  const selected =
                    (values[category.key] || 'all') === option.value;
                  return (
                    <button
                      key={option.value}
                      type='button'
                      aria-pressed={selected}
                      className={`max-w-full truncate rounded-full border px-3 py-1.5 text-xs ${
                        selected
                          ? 'border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300'
                      }`}
                      onClick={() =>
                        onChange({ ...values, [category.key]: option.value })
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </MobileFilterSheet>

      <MobileSheet
        open={sortOpen}
        title='排序'
        onClose={() => setSortOpen(false)}
      >
        <div className='space-y-1 pb-2'>
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type='button'
              className={`flex h-11 w-full items-center gap-2 rounded-lg px-3 text-sm ${
                yearOrder === option.value
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'text-gray-700 dark:text-gray-200'
              }`}
              onClick={() => {
                onChange({ ...values, yearOrder: option.value });
                setSortOpen(false);
              }}
            >
              <option.icon className='h-4 w-4' />
              {option.label}
            </button>
          ))}
        </div>
      </MobileSheet>
    </>
  );
}
