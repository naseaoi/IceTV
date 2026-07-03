'use client';

import { X } from 'lucide-react';

import ModalShell from '@/components/modals/ModalShell';
import { PasswordInput } from '@/components/PasswordInput';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';

interface ChangePasswordFormProps {
  username: string;
  password: string;
  isOpen: boolean;
  onPasswordChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function ChangePasswordForm({
  username,
  password,
  isOpen,
  onPasswordChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: ChangePasswordFormProps) {
  const disabled = !password || isSubmitting;

  return (
    <ModalShell isOpen={isOpen} onClose={onCancel} panelClassName='max-w-md'>
      <div className='space-y-4 p-6'>
        <div className='flex items-center justify-between'>
          <h5 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
            修改用户密码
          </h5>
          <button
            onClick={onCancel}
            aria-label='关闭'
            className='text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
          >
            <X className='h-5 w-5' />
          </button>
        </div>
        <div className='space-y-3'>
          <input
            type='text'
            placeholder='用户名'
            value={username}
            disabled
            className='w-full cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
          />
          <PasswordInput
            placeholder='新密码'
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </div>
        <div className='flex justify-end space-x-2'>
          <button onClick={onCancel} className={buttonStyles.secondary}>
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled}
            className={disabled ? buttonStyles.disabled : buttonStyles.primary}
          >
            {isSubmitting ? '修改中...' : '修改密码'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
