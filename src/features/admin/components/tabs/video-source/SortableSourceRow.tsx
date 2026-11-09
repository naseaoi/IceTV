'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CSSProperties } from 'react';

import MoreMenu from '@/components/MoreMenu';
import Select from '@/components/Select';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import {
  describeSourceHealth,
  formatLastOkDate,
  SOURCE_HEALTH_CHIP_CLASS,
  SOURCE_HEALTH_SCORE_CLASS,
  SOURCE_HEALTH_TIER_LABEL,
} from '@/features/admin/components/tabs/video-source/sourceHealthView';
import { checkboxStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';
import {
  type SourceProxyMode,
  DEFAULT_SOURCE_PROXY_MODE,
} from '@/lib/proxy-modes';
import type { SourceHealthReportItem } from '@/lib/source-quality-policy';

export type SourceValidationStatus = {
  text: string;
  className: string;
  icon: string;
  message: string;
};

export type RouteModeStats = {
  successCount: number;
  failureCount: number;
  totalCount: number;
  successRate: number | null;
};

export type SourceRouteStatsView = {
  browser?: RouteModeStats;
  server?: RouteModeStats;
};

const PROXY_MODE_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'browser', label: '直连' },
  { value: 'server', label: '代理' },
];

function isSourceProxyMode(value: string): value is SourceProxyMode {
  return value === 'auto' || value === 'browser' || value === 'server';
}

interface SortableSourceRowProps {
  source: DataSource;
  isSelected: boolean;
  validationStatus: SourceValidationStatus | null;
  sourceRouteStats: SourceRouteStatsView | null;
  sourceHealth: SourceHealthReportItem | null;
  healthDays: number;
  isProxyModeLoading: boolean;
  isSortingDisabled?: boolean;
  isToggleLoading: boolean;
  isAdminOnlyLoading: boolean;
  isDeleteLoading: boolean;
  isValidationLoading: boolean;
  onSelectSource: (key: string, checked: boolean) => void;
  onChangeProxyMode: (key: string, proxyMode: SourceProxyMode) => void;
  onToggleEnable: (key: string) => void;
  onToggleAdminOnly: (key: string) => void;
  onValidate: (key: string) => void;
  onEdit: (source: DataSource) => void;
  onDelete: (key: string) => void;
}

export function SortableSourceRow({
  source,
  isSelected,
  validationStatus,
  sourceRouteStats,
  sourceHealth,
  healthDays,
  isProxyModeLoading,
  isSortingDisabled = false,
  isToggleLoading,
  isAdminOnlyLoading,
  isDeleteLoading,
  isValidationLoading,
  onSelectSource,
  onChangeProxyMode,
  onToggleEnable,
  onToggleAdminOnly,
  onValidate,
  onEdit,
  onDelete,
}: SortableSourceRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: source.key, disabled: isSortingDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  const proxyMode = source.proxyMode || DEFAULT_SOURCE_PROXY_MODE;

  const routeRate = (stats?: RouteModeStats) =>
    stats && stats.successRate !== null
      ? `${Math.round(stats.successRate * 100)}%`
      : '—';
  const routeSummary = `直连 ${routeRate(sourceRouteStats?.browser)} · 代理 ${routeRate(sourceRouteStats?.server)}`;
  const routeDetails = ['browser', 'server']
    .map((mode) => {
      const stats = sourceRouteStats?.[mode as keyof SourceRouteStatsView];
      return `${mode === 'browser' ? '直连' : '代理'} ${stats ? `${stats.successCount}/${stats.totalCount}` : '—'}`;
    })
    .join(' · ');
  const description = [source.api, source.detail].filter(Boolean).join(' · ');
  const healthChipClass = sourceHealth
    ? SOURCE_HEALTH_CHIP_CLASS[sourceHealth.tier]
    : undefined;
  const healthTitle = sourceHealth
    ? describeSourceHealth(sourceHealth, healthDays)
    : '暂无质量数据';
  return (
    <li
      ref={setNodeRef}
      style={style}
      className='flex flex-wrap items-center gap-3 bg-white px-3 py-3 transition-colors last:rounded-b-xl hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-white/[0.02]'
    >
      <button
        type='button'
        className={`shrink-0 text-gray-400 ${isSortingDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-grab'}`}
        style={{ touchAction: isSortingDisabled ? 'auto' : 'none' }}
        {...attributes}
        {...(isSortingDisabled ? {} : listeners)}
        aria-label={`拖动排序 ${source.name}`}
        aria-disabled={isSortingDisabled}
        disabled={isSortingDisabled}
        tabIndex={isSortingDisabled ? -1 : attributes.tabIndex}
      >
        <GripVertical size={16} />
      </button>
      <input
        type='checkbox'
        aria-label={`选择 ${source.name}`}
        checked={isSelected}
        onChange={(event) => onSelectSource(source.key, event.target.checked)}
        className={`shrink-0 ${checkboxStyles}`}
      />
      <div className={`min-w-0 flex-1 ${source.disabled ? 'opacity-50' : ''}`}>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          <span
            className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'
            title={source.name}
          >
            {source.name}
          </span>
          <span
            className='max-w-full truncate rounded bg-gray-100 px-1.5 font-mono text-xs text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
            title={source.key}
          >
            {source.key}
          </span>
          {source.disabled && (
            <span className='text-xs text-gray-500 dark:text-gray-400'>
              已停用
            </span>
          )}
          {sourceHealth && healthChipClass && (
            <span
              className={`rounded px-1.5 text-xs ${healthChipClass}`}
              title={healthTitle}
            >
              {SOURCE_HEALTH_TIER_LABEL[sourceHealth.tier]}
              {sourceHealth.tier === 'offline' &&
                sourceHealth.lastOkDate &&
                ` · ${formatLastOkDate(sourceHealth.lastOkDate)}可用`}
            </span>
          )}
          {source.adminOnly && (
            <span className='rounded bg-gray-100 px-1.5 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'>
              仅管理员
            </span>
          )}
          {validationStatus && (
            <span
              className={`rounded px-1.5 text-xs ${validationStatus.className}`}
              title={validationStatus.message}
            >
              {validationStatus.text}
            </span>
          )}
        </div>
        <p
          className='mt-1 truncate text-xs text-gray-500 dark:text-gray-400'
          title={description}
        >
          {description}
        </p>
      </div>
      <div className='flex w-full shrink-0 items-center justify-end gap-3 sm:w-auto'>
        <span
          className='hidden whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400 md:inline'
          title={healthTitle}
        >
          质量{' '}
          <span
            className={`font-medium ${
              sourceHealth
                ? SOURCE_HEALTH_SCORE_CLASS[sourceHealth.tier]
                : SOURCE_HEALTH_SCORE_CLASS.insufficient
            }`}
          >
            {sourceHealth?.score ?? '—'}
          </span>
        </span>
        <span
          className='hidden whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400 lg:inline'
          title={`${healthDays}天成功率 · ${routeDetails}`}
        >
          {routeSummary}
        </span>
        <Select
          variant='pill'
          align='end'
          value={proxyMode}
          onChange={(value) => {
            if (isSourceProxyMode(value)) onChangeProxyMode(source.key, value);
          }}
          options={PROXY_MODE_OPTIONS}
          disabled={isProxyModeLoading}
          showSelectedIcon={false}
          ariaLabel={`${source.name}流量路由`}
        />
        <AdminStatusSwitch
          enabled={!source.disabled}
          isLoading={isToggleLoading}
          ariaLabel={`${source.name}状态`}
          onToggle={() => onToggleEnable(source.key)}
        />
        <MoreMenu
          label={`${source.name} 的操作`}
          items={[
            {
              label: '编辑',
              onSelect: () => onEdit(source),
              disabled: isDeleteLoading,
            },
            {
              label: '检测',
              onSelect: () => onValidate(source.key),
              disabled: isValidationLoading,
            },
            {
              label: source.adminOnly ? '对所有用户开放' : '仅管理员可用',
              onSelect: () => onToggleAdminOnly(source.key),
              disabled: isAdminOnlyLoading,
            },
            {
              label: '删除',
              onSelect: () => onDelete(source.key),
              danger: true,
              disabled: isDeleteLoading,
            },
          ]}
        />
      </div>
    </li>
  );
}
