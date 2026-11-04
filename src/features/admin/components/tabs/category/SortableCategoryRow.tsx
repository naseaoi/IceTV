'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CSSProperties } from 'react';

import AdminRowMenu from '@/features/admin/components/AdminRowMenu';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { CustomCategory } from '@/features/admin/types/internal';

interface SortableCategoryRowProps {
  category: CustomCategory;
  isSortingDisabled?: boolean;
  isToggleLoading: boolean;
  isDeleteLoading: boolean;
  onToggleEnable: (category: CustomCategory) => void;
  onEdit: (category: CustomCategory) => void;
  onDelete: (category: CustomCategory) => void;
}

export function SortableCategoryRow({
  category,
  isSortingDisabled = false,
  isToggleLoading,
  isDeleteLoading,
  onToggleEnable,
  onEdit,
  onDelete,
}: SortableCategoryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: `${category.query}:${category.type}`,
      disabled: isSortingDisabled,
    });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  const operationsDisabled = isToggleLoading || isDeleteLoading;

  const description = category.query;
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
        aria-label={`拖动排序 ${category.name || category.query}`}
        aria-disabled={isSortingDisabled}
        disabled={isSortingDisabled}
        tabIndex={isSortingDisabled ? -1 : attributes.tabIndex}
      >
        <GripVertical size={16} />
      </button>
      <div
        className={`min-w-0 flex-1 ${category.disabled ? 'opacity-50' : ''}`}
      >
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          <span
            className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'
            title={category.name || '未命名分类'}
          >
            {category.name || '未命名分类'}
          </span>
          <span className='rounded bg-gray-100 px-1.5 text-xs text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'>
            {category.type === 'movie' ? '电影' : '电视剧'}
          </span>
          {category.disabled && (
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
          enabled={!category.disabled}
          isLoading={isToggleLoading}
          ariaLabel={`${category.name || category.query}状态`}
          onToggle={() => onToggleEnable(category)}
        />
        <AdminRowMenu
          label={`${category.name || category.query} 的操作`}
          items={[
            {
              label: '编辑',
              onSelect: () => onEdit(category),
              disabled: operationsDisabled,
            },
            {
              label: '删除',
              onSelect: () => onDelete(category),
              danger: true,
              disabled: operationsDisabled,
            },
          ]}
        />
      </div>
    </li>
  );
}
