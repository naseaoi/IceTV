'use client';

import { X } from 'lucide-react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { LiveDataSource } from '@/features/admin/types/internal';

interface LiveSourceEditFormProps {
  editingLiveSource: LiveDataSource | null;
  isOpen: boolean;
  error?: string;
  onChange: (value: LiveDataSource) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function LiveSourceEditForm({
  editingLiveSource,
  isOpen,
  error,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: LiveSourceEditFormProps) {
  const disabled =
    !editingLiveSource ||
    !editingLiveSource.name ||
    !editingLiveSource.url ||
    isSubmitting;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      panelClassName='max-w-2xl max-h-[80vh] overflow-y-auto'
    >
      {error && (
        <p role='alert' className='px-4 pt-3 text-sm text-red-600'>
          {error}
        </p>
      )}
      {editingLiveSource && (
        <div className='space-y-4 p-4 sm:p-6'>
          <div className='flex items-start justify-between gap-3'>
            <h5 className={MODAL_TITLE_CLASS}>
              编辑直播源: {editingLiveSource.name}
            </h5>
            <button
              onClick={onCancel}
              aria-label='关闭'
              className={MODAL_CLOSE_BUTTON_CLASS}
            >
              <X className='h-5 w-5' />
            </button>
          </div>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div>
              <label className='mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100'>
                名称
              </label>
              <input
                type='text'
                value={editingLiveSource.name}
                onChange={(e) =>
                  onChange({ ...editingLiveSource, name: e.target.value })
                }
                className={`w-full ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100'>
                Key
              </label>
              <input
                type='text'
                value={editingLiveSource.key}
                disabled
                className={`w-full ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100'>
                M3U 地址
              </label>
              <input
                type='text'
                value={editingLiveSource.url}
                onChange={(e) =>
                  onChange({ ...editingLiveSource, url: e.target.value })
                }
                className={`w-full ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100'>
                节目单地址（选填）
              </label>
              <input
                type='text'
                value={editingLiveSource.epg}
                onChange={(e) =>
                  onChange({ ...editingLiveSource, epg: e.target.value })
                }
                className={`w-full ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100'>
                自定义 UA（选填）
              </label>
              <input
                type='text'
                value={editingLiveSource.ua}
                onChange={(e) =>
                  onChange({ ...editingLiveSource, ua: e.target.value })
                }
                className={`w-full ${inputStyles.withFocus}`}
              />
            </div>
          </div>
          <div className='flex justify-end space-x-2'>
            <button onClick={onCancel} className={buttonStyles.outline}>
              取消
            </button>
            <button
              onClick={onSubmit}
              disabled={disabled}
              className={`${buttonStyles.primary} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {isSubmitting ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
