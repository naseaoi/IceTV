'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CSSProperties } from 'react';

import {
  buttonStyles,
  statusBadgeStyles,
} from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

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

interface SortableSourceRowProps {
  source: DataSource;
  isSelected: boolean;
  validationStatus: SourceValidationStatus | null;
  sourceRouteStats: SourceRouteStatsView | null;
  isProxyModeLoading: boolean;
  isToggleLoading: boolean;
  isDeleteLoading: boolean;
  isValidationLoading: boolean;
  onSelectSource: (key: string, checked: boolean) => void;
  onToggleProxyMode: (key: string) => void;
  onToggleEnable: (key: string) => void;
  onValidate: (key: string) => void;
  onEdit: (source: DataSource) => void;
  onDelete: (key: string) => void;
}

export function SortableSourceRow({
  source,
  isSelected,
  validationStatus,
  sourceRouteStats,
  isProxyModeLoading,
  isToggleLoading,
  isDeleteLoading,
  isValidationLoading,
  onSelectSource,
  onToggleProxyMode,
  onToggleEnable,
  onValidate,
  onEdit,
  onDelete,
}: SortableSourceRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: source.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  const proxyMode = source.proxyMode || 'browser';
  const proxyModeClassName =
    proxyMode === 'server'
      ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40'
      : proxyMode === 'auto'
        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:hover:bg-gray-800/40';
  const proxyModeTitle =
    proxyMode === 'server'
      ? '播放和测速流量走服务端代理'
      : proxyMode === 'auto'
        ? '播放和测速流量自动选择路由'
        : '播放和测速流量走浏览器直连';
  const proxyModeText =
    proxyMode === 'server'
      ? '服务端'
      : proxyMode === 'auto'
        ? '自动'
        : '浏览器';

  const renderRouteStats = (label: string, stats?: RouteModeStats) => {
    const rate =
      stats && stats.successRate !== null
        ? `${Math.round(stats.successRate * 100)}%`
        : '-';
    const count = stats ? `${stats.successCount}/${stats.totalCount}` : '-';
    return (
      <div className='flex items-center justify-between gap-3'>
        <span className='text-gray-500 dark:text-gray-400'>{label}</span>
        <span className='font-medium text-gray-900 dark:text-gray-100'>
          {rate}
        </span>
        <span className='text-gray-500 dark:text-gray-400'>{count}</span>
      </div>
    );
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className='select-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800'
    >
      <td
        className='cursor-grab px-2 py-4 text-gray-400'
        style={{ touchAction: 'none' }}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </td>
      <td className='px-2 py-4 text-center'>
        <input
          type='checkbox'
          checked={isSelected}
          onChange={(e) => onSelectSource(source.key, e.target.checked)}
          className='h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 accent-blue-600 checked:border-blue-600 checked:bg-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:accent-blue-500 dark:ring-offset-gray-800 dark:checked:border-blue-500 dark:checked:bg-blue-500 dark:focus:ring-blue-600'
        />
      </td>
      <td className='whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
        {source.name}
      </td>
      <td className='whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
        {source.key}
      </td>
      <td
        className='max-w-[12rem] truncate whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'
        title={source.api}
      >
        {source.api}
      </td>
      <td
        className='max-w-[8rem] truncate whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'
        title={source.detail || '-'}
      >
        {source.detail || '-'}
      </td>
      <td className='max-w-[1rem] whitespace-nowrap px-6 py-4'>
        <button
          onClick={() => onToggleEnable(source.key)}
          disabled={isToggleLoading}
          className={`rounded-full px-2 py-1 text-xs transition-colors ${
            !source.disabled
              ? statusBadgeStyles.enabled
              : statusBadgeStyles.disabled
          } ${isToggleLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          title={!source.disabled ? '点击禁用' : '点击启用'}
        >
          {!source.disabled ? '启用中' : '已禁用'}
        </button>
      </td>
      <td className='whitespace-nowrap px-6 py-4'>
        <button
          onClick={() => onToggleProxyMode(source.key)}
          disabled={isProxyModeLoading}
          className={`rounded-full px-2 py-1 text-xs transition-colors ${proxyModeClassName} ${isProxyModeLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          title={proxyModeTitle}
        >
          {proxyModeText}
        </button>
      </td>
      <td className='min-w-[9rem] whitespace-nowrap px-6 py-4 text-xs'>
        <div className='space-y-1'>
          {renderRouteStats('直连', sourceRouteStats?.browser)}
          {renderRouteStats('代理', sourceRouteStats?.server)}
        </div>
      </td>
      <td className='max-w-[1rem] whitespace-nowrap px-6 py-4'>
        {validationStatus ? (
          <span
            className={`rounded-full px-2 py-1 text-xs ${validationStatus.className}`}
            title={validationStatus.message}
          >
            {validationStatus.icon} {validationStatus.text}
          </span>
        ) : (
          <button
            onClick={() => onValidate(source.key)}
            disabled={isValidationLoading}
            className={`rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:hover:bg-gray-800/40 ${
              isValidationLoading ? 'cursor-not-allowed opacity-50' : ''
            }`}
            title='点击检测该源'
          >
            未检测
          </button>
        )}
      </td>
      <td className='space-x-2 whitespace-nowrap px-6 py-4 text-right text-sm font-medium'>
        <button
          onClick={() => onEdit(source)}
          className={buttonStyles.roundedPrimary}
        >
          编辑
        </button>
        <button
          onClick={() => onDelete(source.key)}
          disabled={isDeleteLoading}
          className={`${buttonStyles.roundedSecondary} ${
            isDeleteLoading ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          删除
        </button>
      </td>
    </tr>
  );
}
