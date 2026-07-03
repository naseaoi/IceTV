'use client';

import AdminDialog from '@/features/admin/components/AdminDialog';
import { ApiSourcePicker } from '@/features/admin/components/tabs/user-config/ApiSourcePicker';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface UserGroupDraft {
  name: string;
  enabledApis: string[];
}

interface UserGroupFormDialogProps {
  mode: 'add' | 'edit';
  isOpen: boolean;
  value: UserGroupDraft;
  onChange: (next: UserGroupDraft) => void;
  sources: DataSource[];
  onClose: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function UserGroupFormDialog({
  mode,
  isOpen,
  value,
  onChange,
  sources,
  onClose,
  onSubmit,
  isSubmitting,
}: UserGroupFormDialogProps) {
  const title = mode === 'add' ? '添加新用户组' : `编辑用户组 - ${value.name}`;
  const submitText = mode === 'add' ? '添加用户组' : '保存修改';
  const loadingText = mode === 'add' ? '添加中...' : '保存中...';
  const isAdd = mode === 'add';
  const selectableApiKeys = sources
    .filter((source) => !source.disabled)
    .map((source) => source.key);
  const isAllSelected =
    selectableApiKeys.length > 0 &&
    selectableApiKeys.every((key) => value.enabledApis.includes(key));

  return (
    <AdminDialog
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      panelClassName='max-w-4xl max-h-[80vh] overflow-y-auto'
    >
      <div className='space-y-6'>
        {isAdd && (
          <div>
            <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
              用户组名称
            </label>
            <input
              type='text'
              placeholder='请输入用户组名称'
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
          </div>
        )}

        <div>
          <div className='mb-4 flex items-center justify-between gap-3'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
              可用视频源
            </label>
            <label className='flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400'>
              <input
                type='checkbox'
                checked={isAllSelected}
                onChange={(event) =>
                  onChange({
                    ...value,
                    enabledApis: event.target.checked ? selectableApiKeys : [],
                  })
                }
                className={`rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 ${
                  isAdd
                    ? 'text-blue-600 focus:ring-blue-500 dark:text-blue-500'
                    : 'text-purple-600 focus:ring-purple-500 dark:text-purple-500'
                }`}
              />
              全选
            </label>
          </div>
          <ApiSourcePicker
            sources={sources}
            selected={value.enabledApis}
            onChange={(next) => onChange({ ...value, enabledApis: next })}
            variant={isAdd ? 'blue' : 'purple'}
          />
        </div>

        <div className='flex justify-end space-x-3 border-t border-gray-200 pt-4 dark:border-gray-700'>
          <button
            onClick={onClose}
            className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={isSubmitting || (isAdd && !value.name.trim())}
            className={`px-6 py-2.5 text-sm font-medium ${
              isSubmitting || (isAdd && !value.name.trim())
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isSubmitting ? loadingText : submitText}
          </button>
        </div>
      </div>
    </AdminDialog>
  );
}
