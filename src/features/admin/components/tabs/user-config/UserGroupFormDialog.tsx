'use client';

import AdminDialog from '@/features/admin/components/AdminDialog';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { ApiSourcePicker } from '@/features/admin/components/tabs/user-config/ApiSourcePicker';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

export interface UserGroupDraft {
  name: string;
  enabledApis: string[];
  allowLive?: boolean;
}

export const EMPTY_USER_GROUP_DRAFT: UserGroupDraft = {
  name: '',
  enabledApis: [],
};

interface UserGroupFormDialogProps {
  mode: 'add' | 'edit';
  isOpen: boolean;
  value: UserGroupDraft;
  onChange: (next: UserGroupDraft) => void;
  sources: DataSource[];
  showLiveAccess: boolean;
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
  showLiveAccess,
  onClose,
  onSubmit,
  isSubmitting,
}: UserGroupFormDialogProps) {
  const title = mode === 'add' ? '添加新用户组' : `编辑用户组 - ${value.name}`;
  const submitText = mode === 'add' ? '添加用户组' : '保存修改';
  const loadingText = mode === 'add' ? '添加中...' : '保存中...';
  const isAdd = mode === 'add';

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

        {showLiveAccess && (
          <div className='flex items-center justify-between gap-3'>
            <span className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              可看直播
            </span>
            <AdminStatusSwitch
              enabled={value.allowLive === true}
              ariaLabel='切换该用户组的直播权限'
              onToggle={() =>
                onChange({ ...value, allowLive: value.allowLive !== true })
              }
            />
          </div>
        )}

        <div>
          <div className='mb-3 text-sm font-medium text-gray-900 dark:text-gray-100'>
            可用视频源
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
