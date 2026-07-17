'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CSSProperties } from 'react';

import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { CustomCategory } from '@/features/admin/types/internal';

interface SortableCategoryRowProps {
  category: CustomCategory;
  isToggleLoading: boolean;
  isDeleteLoading: boolean;
  onToggleEnable: (category: CustomCategory) => void;
  onEdit: (category: CustomCategory) => void;
  onDelete: (category: CustomCategory) => void;
}

export function SortableCategoryRow({
  category,
  isToggleLoading,
  isDeleteLoading,
  onToggleEnable,
  onEdit,
  onDelete,
}: SortableCategoryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: `${category.query}:${category.type}` });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  const operationsDisabled = isToggleLoading || isDeleteLoading;

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
        {category.name || '-'}
      </td>
      <td className='whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            category.type === 'movie'
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
              : 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300'
          }`}
        >
          {category.type === 'movie' ? '电影' : '电视剧'}
        </span>
      </td>
      <td
        className='truncate whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'
        title={category.query}
      >
        {category.query}
      </td>
      <td className='whitespace-nowrap px-6 py-4'>
        <AdminStatusSwitch
          enabled={!category.disabled}
          isLoading={isToggleLoading}
          ariaLabel={`${category.name || category.query}状态`}
          onToggle={() => onToggleEnable(category)}
        />
      </td>
      <td className='space-x-2 whitespace-nowrap px-6 py-4 text-left text-sm font-medium'>
        <button
          type='button'
          onClick={() => onEdit(category)}
          disabled={operationsDisabled}
          className={`${buttonStyles.roundedPrimary} ${
            operationsDisabled ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          编辑
        </button>
        <button
          type='button'
          onClick={() => onDelete(category)}
          disabled={operationsDisabled}
          className={`${buttonStyles.roundedSecondary} ${
            operationsDisabled ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          删除
        </button>
      </td>
    </tr>
  );
}
