'use client';

import { X } from 'lucide-react';

import ModalShell from '@/components/modals/ModalShell';
import AdminSelect from '@/features/admin/components/AdminSelect';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';

interface UserGroupOption {
  name: string;
  enabledApis: string[];
}

interface NewUserDraft {
  username: string;
  password: string;
  userGroup: string;
}

interface AddUserFormProps {
  value: NewUserDraft;
  isOpen: boolean;
  onChange: (next: NewUserDraft) => void;
  userGroups: UserGroupOption[];
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function AddUserForm({
  value,
  isOpen,
  onChange,
  userGroups,
  onSubmit,
  onCancel,
  isSubmitting,
}: AddUserFormProps) {
  const disabled = !value.username || !value.password || isSubmitting;

  return (
    <ModalShell isOpen={isOpen} onClose={onCancel} panelClassName='max-w-md'>
      <div className='space-y-4 p-6'>
        <div className='flex items-center justify-between'>
          <h5 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
            添加用户
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
          <input
            type='text'
            placeholder='用户名'
            value={value.username}
            onChange={(e) => onChange({ ...value, username: e.target.value })}
            className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
          <input
            type='password'
            placeholder='密码'
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
            className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </div>
        <div>
          <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户组（可选）
          </label>
          <AdminSelect
            value={value.userGroup}
            onChange={(next) => onChange({ ...value, userGroup: next })}
            options={[
              { label: '无用户组（无限制）', value: '' },
              ...userGroups.map((group) => ({
                label: `${group.name} (${
                  group.enabledApis && group.enabledApis.length > 0
                    ? `${group.enabledApis.length} 个源`
                    : '无限制'
                })`,
                value: group.name,
              })),
            ]}
            placeholder='无用户组（无限制）'
          />
        </div>
        <div className='flex justify-end space-x-2'>
          <button onClick={onCancel} className={buttonStyles.secondary}>
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled}
            className={disabled ? buttonStyles.disabled : buttonStyles.success}
          >
            {isSubmitting ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
