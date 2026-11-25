'use client';

import { useMemo, useState } from 'react';

import Select from '@/components/Select';
import AdminListToolbar from '@/features/admin/components/AdminListToolbar';
import AdminSearchField from '@/features/admin/components/AdminSearchField';
import { ADMIN_PANEL_CLASS } from '@/features/admin/components/AdminSettings';
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

type SelectionFilter = 'all' | 'selected' | 'unselected';
type SourceFilter = 'all' | 'direct' | 'relay' | 'cleanup' | 'disabled';

const CHIP_CLASS = 'shrink-0 rounded px-1.5 text-xs';
const NEUTRAL_CHIP_CLASS = `${CHIP_CLASS} bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300`;

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
  const [selectionFilter, setSelectionFilter] =
    useState<SelectionFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // 仅切换勾选筛选时更新快照，勾选或切换源条件后条目留在原处。
  const [filterSelection, setFilterSelection] = useState(selectedSet);
  const normalizedQuery = query.trim().toLowerCase();
  const sourceMatchers: Record<SourceFilter, (source: DataSource) => boolean> =
    {
      all: () => true,
      direct: (source) => source.proxyMode !== 'server',
      relay: (source) => source.proxyMode === 'server',
      cleanup: (source) => isSourceCleanupCandidate(health.get(source.key)),
      disabled: (source) => Boolean(source.disabled),
    };
  const visibleSources = sources.filter(
    (source) =>
      (selectionFilter === 'all' ||
        filterSelection.has(source.key) === (selectionFilter === 'selected')) &&
      sourceMatchers[sourceFilter](source) &&
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
      <AdminListToolbar
        search={
          <AdminSearchField
            value={query}
            onChange={setQuery}
            label='搜索视频源'
          />
        }
        filters={
          <>
            <Select
              variant='pill'
              align='end'
              showSelectedIcon={false}
              ariaLabel='筛选勾选状态'
              value={selectionFilter}
              onChange={(value) => {
                setSelectionFilter(value as SelectionFilter);
                setFilterSelection(selectedSet);
              }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'selected', label: '已选' },
                { value: 'unselected', label: '未选' },
              ]}
            />
            <Select
              variant='pill'
              align='end'
              showSelectedIcon={false}
              ariaLabel='筛选视频源'
              value={sourceFilter}
              onChange={(value) => setSourceFilter(value as SourceFilter)}
              options={[
                { value: 'all', label: '全部源' },
                { value: 'direct', label: '直连或自动' },
                { value: 'relay', label: '代理' },
                { value: 'cleanup', label: '待清理' },
                { value: 'disabled', label: '已禁用' },
              ]}
            />
          </>
        }
      />

      <div className={ADMIN_PANEL_CLASS}>
        <div className='flex h-10 items-center gap-3 rounded-t-xl bg-gray-50 px-3 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400'>
          <input
            type='checkbox'
            aria-label='全选'
            checked={isAllVisibleSelected}
            disabled={selectableKeys.length === 0}
            onChange={(event) => handleToggleVisible(event.target.checked)}
            className={checkboxStyles}
          />
          <span className='tabular-nums'>共 {visibleSources.length} 个</span>
        </div>

        {visibleSources.length === 0 ? (
          <div className='py-8 text-center text-sm text-gray-500 dark:text-gray-400'>
            没有符合条件的视频源
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3'>
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
                      {sourceMatchers.relay(source) && (
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
    </div>
  );
}
