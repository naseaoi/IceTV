'use client';

import AdminSelect from '@/components/admin/AdminSelect';
import AdminDialog from '@/features/admin/components/AdminDialog';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';

interface UserGroupOption {
  name: string;
  enabledApis: string[];
}

interface BatchUserGroupDialogProps {
  isOpen: boolean;
  selectedGroup: string;
  userGroups: UserGroupOption[];
  onSelectedGroupChange: (next: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  isSaving: boolean;
}

export function BatchUserGroupDialog({
  isOpen,
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
      panelClassName='max-w-md'
    >
      <div className='mb-6'>
        <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
          用户组
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
