'use client';

import { X } from 'lucide-react';

import AdminSelect from '@/components/admin/AdminSelect';
import ModalShell from '@/components/modals/ModalShell';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { CustomCategory } from '@/features/admin/types/internal';

interface CategoryEditFormProps {
  category: CustomCategory | null;
  isOpen: boolean;
  typeOptions: { value: string; label: string }[];
  onChange: (value: CustomCategory) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function CategoryEditForm({
  category,
  isOpen,
  typeOptions,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: CategoryEditFormProps) {
  const disabled = !category?.name || !category.query || isSubmitting;

  return (
    <ModalShell isOpen={isOpen} onClose={onCancel} panelClassName='max-w-2xl'>
      {category && (
        <div className='space-y-4 p-6'>
          <div className='flex items-center justify-between'>
            <h5 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
              编辑分类：{category.name}
            </h5>
            <button
              type='button'
              onClick={onCancel}
              aria-label='关闭'
              className='text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
            >
              <X className='h-5 w-5' />
            </button>
          </div>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div>
              <label className='mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300'>
                分类名称
              </label>
              <input
                type='text'
                value={category.name || ''}
                maxLength={64}
                onChange={(event) =>
                  onChange({ ...category, name: event.target.value })
                }
                className={`w-full ${inputStyles.base}`}
              />
            </div>
            <div>
              <label className='mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300'>
                类型
              </label>
              <AdminSelect
                value={category.type}
                onChange={(value) => {
                  if (value === 'movie' || value === 'tv') {
                    onChange({ ...category, type: value });
                  }
                }}
                options={typeOptions}
              />
            </div>
            <div className='sm:col-span-2'>
              <label className='mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300'>
                搜索关键词
              </label>
              <input
                type='text'
                value={category.query}
                maxLength={200}
                onChange={(event) =>
                  onChange({ ...category, query: event.target.value })
                }
                className={`w-full ${inputStyles.base}`}
              />
            </div>
          </div>
          <div className='flex justify-end space-x-2'>
            <button
              type='button'
              onClick={onCancel}
              className={buttonStyles.secondary}
            >
              取消
            </button>
            <button
              type='button'
              onClick={onSubmit}
              disabled={disabled}
              className={
                disabled ? buttonStyles.disabled : buttonStyles.success
              }
            >
              {isSubmitting ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
