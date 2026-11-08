'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CSSProperties } from 'react';

import MoreMenu from '@/components/MoreMenu';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { LiveDataSource } from '@/features/admin/types/internal';

interface SortableLiveSourceRowProps {
  liveSource: LiveDataSource;
  isSortingDisabled?: boolean;
  isToggleLoading: boolean;
  isEditLoading: boolean;
  isDeleteLoading: boolean;
  onToggleEnable: (key: string) => void;
  onEdit: (liveSource: LiveDataSource) => void;
  onDelete: (key: string) => void;
}

export function SortableLiveSourceRow({
  liveSource,
  isSortingDisabled = false,
  isToggleLoading,
  isEditLoading,
  isDeleteLoading,
  onToggleEnable,
  onEdit,
  onDelete,
}: SortableLiveSourceRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: liveSource.key, disabled: isSortingDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;

  const description = [
    liveSource.url,
    liveSource.epg && `EPG ${liveSource.epg}`,
    liveSource.ua && `UA ${liveSource.ua}`,
    liveSource.channelNumber && liveSource.channelNumber > 0
      ? `${liveSource.channelNumber} 个频道`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
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
        aria-label={`拖动排序 ${liveSource.name}`}
        aria-disabled={isSortingDisabled}
        disabled={isSortingDisabled}
        tabIndex={isSortingDisabled ? -1 : attributes.tabIndex}
      >
        <GripVertical size={16} />
      </button>
      <div
        className={`min-w-0 flex-1 ${liveSource.disabled ? 'opacity-50' : ''}`}
      >
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          <span
            className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'
            title={liveSource.name}
          >
            {liveSource.name}
          </span>
          <span
            className='max-w-full truncate rounded bg-gray-100 px-1.5 font-mono text-xs text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
            title={liveSource.key}
          >
            {liveSource.key}
          </span>
          {liveSource.disabled && (
            <span className='text-xs text-gray-500 dark:text-gray-400'>
              已停用
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
        <AdminStatusSwitch
          enabled={!liveSource.disabled}
          isLoading={isToggleLoading}
          ariaLabel={`${liveSource.name}状态`}
          onToggle={() => onToggleEnable(liveSource.key)}
        />
        <MoreMenu
          label={`${liveSource.name} 的操作`}
          items={[
            {
              label: '编辑',
              onSelect: () => onEdit(liveSource),
              disabled: isEditLoading,
            },
            {
              label: '删除',
              onSelect: () => onDelete(liveSource.key),
              danger: true,
              disabled: isDeleteLoading,
            },
          ]}
        />
      </div>
    </li>
  );
}
