'use client';

import AdminDialog from '@/features/admin/components/AdminDialog';
import { ApiSourcePicker } from '@/features/admin/components/tabs/user-config/ApiSourcePicker';
import {
  buttonStyles,
  checkboxStyles,
  inputStyles,
} from '@/features/admin/lib/buttonStyles';
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
            <label className='mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100'>
              用户组名称
            </label>
            <input
              type='text'
              placeholder='请输入用户组名称'
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              className={`w-full ${inputStyles.withFocus}`}
            />
          </div>
        )}

        <div>
          <div className='mb-4 flex items-center justify-between gap-3'>
            <label className='block text-sm font-medium text-gray-900 dark:text-gray-100'>
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
                className={checkboxStyles}
              />
              全选
            </label>
          </div>
          <ApiSourcePicker
            sources={sources}
            selected={value.enabledApis}
            onChange={(next) => onChange({ ...value, enabledApis: next })}
          />
        </div>

        <div className='flex justify-end space-x-3 pt-4'>
          <button onClick={onClose} className={buttonStyles.outline}>
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={isSubmitting || (isAdd && !value.name.trim())}
            className={`${buttonStyles.primary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isSubmitting ? loadingText : submitText}
          </button>
        </div>
      </div>
    </AdminDialog>
  );
}
