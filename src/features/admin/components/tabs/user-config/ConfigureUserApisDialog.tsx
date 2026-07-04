'use client';

import AdminDialog from '@/features/admin/components/AdminDialog';
import { ApiSourcePicker } from '@/features/admin/components/tabs/user-config/ApiSourcePicker';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface ConfigureUserApisDialogProps {
  isOpen: boolean;
  username: string;
  sources: DataSource[];
  selectedApis: string[];
  onSelectedApisChange: (next: string[]) => void;
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
}

export function ConfigureUserApisDialog({
  isOpen,
  username,
  sources,
  selectedApis,
  onSelectedApisChange,
  onClose,
  onSave,
  isSaving,
}: ConfigureUserApisDialogProps) {
  const selectableApiKeys = sources
    .filter((source) => !source.disabled)
    .map((source) => source.key);
  const isAllSelected =
    selectableApiKeys.length > 0 &&
    selectableApiKeys.every((key) => selectedApis.includes(key));

  return (
    <AdminDialog
      isOpen={isOpen}
      title={`配置用户采集源权限 - ${username}`}
      onClose={onClose}
      panelClassName='max-w-4xl max-h-[80vh] overflow-y-auto'
    >
      <div className='mb-6'>
        <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20'>
          <div className='mb-2 flex items-center space-x-2'>
            <svg
              className='h-5 w-5 text-blue-600 dark:text-blue-400'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
              />
            </svg>
            <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
              配置说明
            </span>
          </div>
          <p className='mt-1 text-sm text-blue-700 dark:text-blue-400'>
            全不选为无限制，选中的采集源将限制用户只能访问这些源
          </p>
        </div>
      </div>

      <div className='mb-6'>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            选择可用的采集源：
          </h4>
          <label className='flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400'>
            <input
              type='checkbox'
              checked={isAllSelected}
              onChange={(event) =>
                onSelectedApisChange(
                  event.target.checked ? selectableApiKeys : [],
                )
              }
              className='rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500'
            />
            全选
          </label>
        </div>
        <ApiSourcePicker
          sources={sources}
          selected={selectedApis}
          onChange={onSelectedApisChange}
        />
      </div>

      <div className='mb-6 flex flex-wrap items-center justify-between rounded-lg bg-gray-50 p-4 dark:bg-gray-900'>
        <div className='text-sm text-gray-600 dark:text-gray-400'>
          已选择：
          <span className='font-medium text-blue-600 dark:text-blue-400'>
            {selectedApis.length > 0 ? `${selectedApis.length} 个源` : '无限制'}
          </span>
        </div>
      </div>

      <div className='flex justify-end space-x-3'>
        <button
          onClick={onClose}
          className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
        >
          取消
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          className={`px-6 py-2.5 text-sm font-medium ${
            isSaving ? buttonStyles.disabled : buttonStyles.primary
          }`}
        >
          {isSaving ? '配置中...' : '确认配置'}
        </button>
      </div>
    </AdminDialog>
  );
}
