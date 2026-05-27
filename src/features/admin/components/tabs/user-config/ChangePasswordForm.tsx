'use client';

import { buttonStyles } from '@/features/admin/lib/buttonStyles';

interface ChangePasswordFormProps {
  username: string;
  password: string;
  onPasswordChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function ChangePasswordForm({
  username,
  password,
  onPasswordChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: ChangePasswordFormProps) {
  const disabled = !password || isSubmitting;

  return (
    <div className='mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-900/20'>
      <h5 className='mb-3 text-sm font-medium text-blue-800 dark:text-blue-300'>
        修改用户密码
      </h5>
      <div className='flex flex-col gap-4 sm:flex-row sm:gap-3'>
        <input
          type='text'
          placeholder='用户名'
          value={username}
          disabled
          className='flex-1 cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
        />
        <input
          type='password'
          placeholder='新密码'
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          className='flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
        />
        <button
          onClick={onSubmit}
          disabled={disabled}
          className={`w-full sm:w-auto ${
            disabled ? buttonStyles.disabled : buttonStyles.primary
          }`}
        >
          {isSubmitting ? '修改中...' : '修改密码'}
        </button>
        <button
          onClick={onCancel}
          className={`w-full sm:w-auto ${buttonStyles.secondary}`}
        >
          取消
        </button>
      </div>
    </div>
  );
}
