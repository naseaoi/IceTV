'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CSSProperties } from 'react';

import AdminSelect from '@/components/admin/AdminSelect';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import {
  buttonStyles,
  checkboxStyles,
} from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';
import {
  type SourceProxyMode,
  DEFAULT_SOURCE_PROXY_MODE,
} from '@/lib/proxy-modes';

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
  isProxyModeLoading: boolean;
  isToggleLoading: boolean;
  isDeleteLoading: boolean;
  isValidationLoading: boolean;
  onSelectSource: (key: string, checked: boolean) => void;
  onChangeProxyMode: (key: string, proxyMode: SourceProxyMode) => void;
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
  onChangeProxyMode,
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
  const proxyMode = source.proxyMode || DEFAULT_SOURCE_PROXY_MODE;

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
          className={checkboxStyles}
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
      <td className='whitespace-nowrap px-6 py-4'>
        <AdminStatusSwitch
          enabled={!source.disabled}
          isLoading={isToggleLoading}
          ariaLabel={`${source.name}状态`}
          onToggle={() => onToggleEnable(source.key)}
        />
      </td>
      <td className='whitespace-nowrap px-6 py-4'>
        <AdminSelect
          value={proxyMode}
          onChange={(value) => {
            if (isSourceProxyMode(value)) {
              onChangeProxyMode(source.key, value);
            }
          }}
          options={PROXY_MODE_OPTIONS}
          disabled={isProxyModeLoading}
          showSelectedIcon={false}
          ariaLabel={`${source.name}流量路由`}
          className='inline-block w-fit'
        />
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
      <td className='space-x-2 whitespace-nowrap px-6 py-4 text-left text-sm font-medium'>
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
