'use client';

import AdminDialog from '@/features/admin/components/AdminDialog';
import AdminSelect from '@/features/admin/components/AdminSelect';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';

interface UserGroupOption {
  name: string;
  enabledApis: string[];
}

interface BatchUserGroupDialogProps {
  isOpen: boolean;
  selectedUserCount: number;
  selectedGroup: string;
  userGroups: UserGroupOption[];
  onSelectedGroupChange: (next: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  isSaving: boolean;
}

export function BatchUserGroupDialog({
  isOpen,
  selectedUserCount,
  selectedGroup,
  userGroups,
  onSelectedGroupChange,
  onClose,
  onConfirm,
  isSaving,
}: BatchUserGroupDialogProps) {
  return (
    <AdminDialog
      isOpen={isOpen}
      title='批量设置用户组'
      onClose={onClose}
      panelClassName='max-w-2xl'
    >
      <div className='mb-6'>
        <div className='mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20'>
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
              批量操作说明
            </span>
          </div>
          <p className='text-sm text-blue-700 dark:text-blue-400'>
            将为选中的 <strong>{selectedUserCount} 个用户</strong>{' '}
            设置用户组，选择&ldquo;无用户组&rdquo;为无限制
          </p>
        </div>

        <div>
          <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
            选择用户组：
          </label>
          <AdminSelect
            value={selectedGroup}
            onChange={onSelectedGroupChange}
            options={[
              { label: '无用户组（无限制）', value: '' },
              ...userGroups.map((group) => ({
                label: `${group.name}${
                  group.enabledApis && group.enabledApis.length > 0
                    ? ` (${group.enabledApis.length} 个源)`
                    : ''
                }`,
                value: group.name,
              })),
            ]}
            placeholder='无用户组（无限制）'
          />
          <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
            选择&ldquo;无用户组&rdquo;为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
          </p>
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
          onClick={onConfirm}
          disabled={isSaving}
          className={`px-6 py-2.5 text-sm font-medium ${
            isSaving ? buttonStyles.disabled : buttonStyles.primary
          }`}
        >
          {isSaving ? '设置中...' : '确认设置'}
        </button>
      </div>
    </AdminDialog>
  );
}
