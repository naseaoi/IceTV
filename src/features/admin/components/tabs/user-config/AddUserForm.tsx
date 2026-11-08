'use client';

import { X } from 'lucide-react';

import AdminSelect from '@/components/admin/AdminSelect';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { PasswordInput } from '@/components/PasswordInput';
import { RandomPasswordButton } from '@/features/admin/components/RandomPasswordButton';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';

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
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      panelClassName='max-w-md max-h-[80vh] overflow-y-auto'
    >
      <div className='space-y-4 p-4 sm:p-6'>
        <div className='flex items-start justify-between gap-3'>
          <h5 className={MODAL_TITLE_CLASS}>添加用户</h5>
          <button
            onClick={onCancel}
            aria-label='关闭'
            className={MODAL_CLOSE_BUTTON_CLASS}
          >
            <X className='h-5 w-5' />
          </button>
        </div>
        <div className='space-y-4'>
          <input
            type='text'
            placeholder='用户名'
            value={value.username}
            onChange={(e) => onChange({ ...value, username: e.target.value })}
            className={`w-full ${inputStyles.withFocus}`}
          />
          <div className='flex items-center gap-2'>
            <PasswordInput
              placeholder='密码'
              value={value.password}
              onChange={(e) => onChange({ ...value, password: e.target.value })}
              wrapperClassName='min-w-0 flex-1'
              className={`w-full pr-10 ${inputStyles.withFocus}`}
            />
            <RandomPasswordButton
              onGenerate={(password) => onChange({ ...value, password })}
            />
          </div>
        </div>
        <div>
          <label className='mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100'>
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
          <button onClick={onCancel} className={buttonStyles.outline}>
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled}
            className={`${buttonStyles.primary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isSubmitting ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
