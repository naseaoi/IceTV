'use client';

import { useCallback, useMemo, useState } from 'react';

import Select from '@/components/Select';
import AdminSearchField from '@/features/admin/components/AdminSearchField';
import {
  isSourceCleanupCandidate,
  SOURCE_HEALTH_CHIP_CLASS,
  SOURCE_HEALTH_TIER_LABEL,
} from '@/features/admin/components/tabs/video-source/sourceHealthView';
import { useSourceInsights } from '@/features/admin/hooks/useSourceInsights';
import { checkboxStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface ApiSourcePickerProps {
  sources: DataSource[];
  selected: string[];
  onChange: (next: string[]) => void;
}

type PickerFilter =
  | 'all'
  | 'selected'
  | 'unselected'
  | 'direct'
  | 'relay'
  | 'cleanup';

const FILTER_LABEL: Record<PickerFilter, string> = {
  all: '全部',
  selected: '已选',
  unselected: '未选',
  direct: '直连 / 自动',
  relay: '代理',
  cleanup: '待清理',
};

const FILTERS = Object.keys(FILTER_LABEL) as PickerFilter[];

const CHIP_CLASS = 'shrink-0 rounded px-1.5 text-xs';
const NEUTRAL_CHIP_CLASS = `${CHIP_CLASS} bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300`;

function isPickerFilter(value: string): value is PickerFilter {
  return (FILTERS as string[]).includes(value);
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

export function ApiSourcePicker({
  sources,
  selected,
  onChange,
}: ApiSourcePickerProps) {
  const { health } = useSourceInsights('api-source-picker');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PickerFilter>('all');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // 列表按选中筛选项那一刻的勾选状态过滤，勾选或全选后条目留在原处；数量仍按实时状态统计
  const [filterSelection, setFilterSelection] = useState(selectedSet);
  const normalizedQuery = query.trim().toLowerCase();

  const createMatchers = useCallback(
    (membership: ReadonlySet<string>) => {
      const isRelay = (source: DataSource) => source.proxyMode === 'server';
      return {
        all: () => true,
        selected: (source: DataSource) => membership.has(source.key),
        unselected: (source: DataSource) => !membership.has(source.key),
        direct: (source: DataSource) => !isRelay(source),
        relay: isRelay,
        cleanup: (source: DataSource) =>
          isSourceCleanupCandidate(health.get(source.key)),
      } satisfies Record<PickerFilter, (source: DataSource) => boolean>;
    },
    [health],
  );
  const matchers = useMemo(
    () => createMatchers(selectedSet),
    [createMatchers, selectedSet],
  );
  const listMatchers = useMemo(
    () => createMatchers(filterSelection),
    [createMatchers, filterSelection],
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((key) => [key, sources.filter(matchers[key]).length]),
      ) as Record<PickerFilter, number>,
    [sources, matchers],
  );

  const visibleSources = sources.filter(
    (source) =>
      listMatchers[filter](source) &&
      (!normalizedQuery ||
        [source.name, source.key, source.api].some((value) =>
          value?.toLowerCase().includes(normalizedQuery),
        )),
  );
  const selectableKeys = visibleSources
    .filter((source) => !source.disabled)
    .map((source) => source.key);
  const isAllVisibleSelected =
    selectableKeys.length > 0 &&
    selectableKeys.every((key) => selectedSet.has(key));

  const handleToggle = (key: string, checked: boolean) => {
    onChange(
      checked ? [...selected, key] : selected.filter((api) => api !== key),
    );
  };

  const handleToggleVisible = (checked: boolean) => {
    if (checked) {
      onChange([
        ...selected,
        ...selectableKeys.filter((key) => !selectedSet.has(key)),
      ]);
      return;
    }
    const visibleKeys = new Set(selectableKeys);
    onChange(selected.filter((key) => !visibleKeys.has(key)));
  };

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <AdminSearchField
          value={query}
          onChange={setQuery}
          label='搜索视频源'
          className='min-w-0 flex-1 sm:w-64 sm:flex-none'
        />
        <Select
          variant='pill'
          ariaLabel='筛选视频源'
          value={filter}
          onChange={(value) => {
            setFilter(isPickerFilter(value) ? value : 'all');
            setFilterSelection(selectedSet);
          }}
          options={FILTERS.map((key) => ({
            value: key,
            label:
              key === 'all'
                ? FILTER_LABEL.all
                : `${FILTER_LABEL[key]} ${counts[key]}`,
          }))}
        />
        <label className='ml-auto flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400'>
          <input
            type='checkbox'
            checked={isAllVisibleSelected}
            disabled={selectableKeys.length === 0}
            onChange={(event) => handleToggleVisible(event.target.checked)}
            className={checkboxStyles}
          />
          全选
        </label>
      </div>

      {visibleSources.length === 0 ? (
        <div className='rounded-lg py-8 text-center text-sm text-gray-500 ring-1 ring-inset ring-gray-200 dark:text-gray-400 dark:ring-white/[0.06]'>
          没有符合条件的视频源
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {visibleSources.map((source) => {
            const tier = health.get(source.key)?.tier;
            const healthChipClass = tier && SOURCE_HEALTH_CHIP_CLASS[tier];
            return (
              <label
                key={source.key}
                className='flex min-w-0 cursor-pointer items-center space-x-3 rounded-lg bg-white p-3 ring-1 ring-inset ring-gray-200 transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:ring-white/[0.06] dark:hover:bg-gray-800'
              >
                <input
                  type='checkbox'
                  checked={selectedSet.has(source.key)}
                  onChange={(e) => handleToggle(source.key, e.target.checked)}
                  className={checkboxStyles}
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex min-w-0 items-center gap-1.5'>
                    <span className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {source.name}
                    </span>
                    {matchers.relay(source) && (
                      <span
                        className={`${CHIP_CLASS} bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300`}
                      >
                        代理
                      </span>
                    )}
                    {tier && healthChipClass && (
                      <span className={`${CHIP_CLASS} ${healthChipClass}`}>
                        {SOURCE_HEALTH_TIER_LABEL[tier]}
                      </span>
                    )}
                    {source.adminOnly && (
                      <span className={NEUTRAL_CHIP_CLASS}>仅管理员</span>
                    )}
                    {source.disabled && (
                      <span className={NEUTRAL_CHIP_CLASS}>已禁用</span>
                    )}
                  </div>
                  {source.api && (
                    <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                      {extractDomain(source.api)}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
