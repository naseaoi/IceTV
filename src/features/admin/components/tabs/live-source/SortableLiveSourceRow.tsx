'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CSSProperties } from 'react';

import {
  buttonStyles,
  statusBadgeStyles,
} from '@/features/admin/lib/buttonStyles';
import { LiveDataSource } from '@/features/admin/types/internal';

interface SortableLiveSourceRowProps {
  liveSource: LiveDataSource;
  isToggleLoading: boolean;
  isEditLoading: boolean;
  isDeleteLoading: boolean;
  onToggleEnable: (key: string) => void;
  onEdit: (liveSource: LiveDataSource) => void;
  onDelete: (key: string) => void;
}

export function SortableLiveSourceRow({
  liveSource,
  isToggleLoading,
  isEditLoading,
  isDeleteLoading,
  onToggleEnable,
  onEdit,
  onDelete,
}: SortableLiveSourceRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: liveSource.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;

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
      <td className='whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
        {liveSource.name}
      </td>
      <td className='whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
        {liveSource.key}
      </td>
      <td
        className='max-w-[12rem] truncate whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'
        title={liveSource.url}
      >
        {liveSource.url}
      </td>
      <td
        className='max-w-[8rem] truncate whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'
        title={liveSource.epg || '-'}
      >
        {liveSource.epg || '-'}
      </td>
      <td
        className='max-w-[8rem] truncate whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'
        title={liveSource.ua || '-'}
      >
        {liveSource.ua || '-'}
      </td>
      <td className='whitespace-nowrap px-6 py-4 text-center text-sm text-gray-900 dark:text-gray-100'>
        {liveSource.channelNumber && liveSource.channelNumber > 0
          ? liveSource.channelNumber
          : '-'}
      </td>
      <td className='max-w-[1rem] whitespace-nowrap px-6 py-4'>
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            !liveSource.disabled
              ? statusBadgeStyles.enabled
              : statusBadgeStyles.disabled
          }`}
        >
          {!liveSource.disabled ? '启用中' : '已禁用'}
        </span>
      </td>
      <td className='space-x-2 whitespace-nowrap px-6 py-4 text-right text-sm font-medium'>
        <button
          onClick={() => onToggleEnable(liveSource.key)}
          disabled={isToggleLoading}
          className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ${
            !liveSource.disabled
              ? buttonStyles.roundedDanger
              : buttonStyles.roundedSuccess
          } transition-colors ${
            isToggleLoading ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          {!liveSource.disabled ? '禁用' : '启用'}
        </button>
        {liveSource.from !== 'config' && (
          <>
            <button
              onClick={() => onEdit(liveSource)}
              disabled={isEditLoading}
              className={`${buttonStyles.roundedPrimary} ${
                isEditLoading ? 'cursor-not-allowed opacity-50' : ''
              }`}
            >
              编辑
            </button>
            <button
              onClick={() => onDelete(liveSource.key)}
              disabled={isDeleteLoading}
              className={`${buttonStyles.roundedSecondary} ${
                isDeleteLoading ? 'cursor-not-allowed opacity-50' : ''
              }`}
            >
              删除
            </button>
          </>
        )}
      </td>
    </tr>
  );
}
