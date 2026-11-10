'use client';

import AdminDialog from '@/features/admin/components/AdminDialog';
import { ApiSourcePicker } from '@/features/admin/components/tabs/user-config/ApiSourcePicker';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface ConfigureUserApisDialogProps {
  isOpen: boolean;
  error?: string;
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
  error,
  username,
  sources,
  selectedApis,
  onSelectedApisChange,
  onClose,
  onSave,
  isSaving,
}: ConfigureUserApisDialogProps) {
  return (
    <AdminDialog
      isOpen={isOpen}
      title={`配置用户视频源权限 - ${username}`}
      onClose={onClose}
      panelClassName='max-w-4xl max-h-[80vh] overflow-y-auto'
    >
      {error && (
        <p role='alert' className='px-4 pt-3 text-sm text-red-600'>
          {error}
        </p>
      )}
      <div className='mb-6'>
        <h4 className='mb-3 text-sm font-medium text-gray-900 dark:text-gray-100'>
          选择可用的视频源：
        </h4>
        <ApiSourcePicker
          sources={sources}
          selected={selectedApis}
          onChange={onSelectedApisChange}
        />
      </div>

      <div className='mb-6 flex flex-wrap items-center justify-between'>
        <div className='text-sm text-gray-600 dark:text-gray-400'>
          已选择：
          <span className='font-medium text-brand-600 dark:text-brand-400'>
            {selectedApis.length > 0 ? `${selectedApis.length} 个源` : '无限制'}
          </span>
        </div>
      </div>

      <div className='flex justify-end space-x-3'>
        <button onClick={onClose} className={buttonStyles.outline}>
          取消
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          className={`${buttonStyles.primary} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {isSaving ? '配置中...' : '确认配置'}
        </button>
      </div>
    </AdminDialog>
  );
}
