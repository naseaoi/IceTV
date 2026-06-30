'use client';

import { X } from 'lucide-react';

import ModalShell from '@/components/modals/ModalShell';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface VideoSourceEditFormProps {
  editingSource: DataSource | null;
  isOpen: boolean;
  onChange: (value: DataSource) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function VideoSourceEditForm({
  editingSource,
  isOpen,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: VideoSourceEditFormProps) {
  const disabled =
    !editingSource || !editingSource.name || !editingSource.api || isSubmitting;

  return (
    <ModalShell isOpen={isOpen} onClose={onCancel} panelClassName='max-w-2xl'>
      {editingSource && (
        <div className='space-y-4 p-6'>
          <div className='flex items-center justify-between'>
            <h5 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
              编辑视频源: {editingSource.name}
            </h5>
            <button
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
                名称
              </label>
              <input
                type='text'
                value={editingSource.name}
                onChange={(e) =>
                  onChange({ ...editingSource, name: e.target.value })
                }
                className={`w-full ${inputStyles.base}`}
              />
            </div>
            <div>
              <label className='mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300'>
                Key (不可编辑)
              </label>
              <input
                type='text'
                value={editingSource.key}
                disabled
                className='w-full cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400'
              />
            </div>
            <div>
              <label className='mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300'>
                API 地址
              </label>
              <input
                type='text'
                value={editingSource.api}
                onChange={(e) =>
                  onChange({ ...editingSource, api: e.target.value })
                }
                className={`w-full ${inputStyles.base}`}
              />
            </div>
            <div>
              <label className='mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300'>
                Detail 地址（选填）
              </label>
              <input
                type='text'
                value={editingSource.detail || ''}
                onChange={(e) =>
                  onChange({ ...editingSource, detail: e.target.value })
                }
                className={`w-full ${inputStyles.base}`}
              />
            </div>
          </div>
          <div className='flex justify-end space-x-2'>
            <button onClick={onCancel} className={buttonStyles.secondary}>
              取消
            </button>
            <button
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
