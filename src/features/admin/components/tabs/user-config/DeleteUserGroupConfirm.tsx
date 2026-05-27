'use client';

import ConfirmModal from '@/components/modals/ConfirmModal';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';

interface AffectedUser {
  username: string;
  role: 'user' | 'admin' | 'owner';
}

interface DeleteUserGroupConfirmProps {
  isOpen: boolean;
  groupName: string;
  affectedUsers: AffectedUser[];
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteUserGroupConfirm({
  isOpen,
  groupName,
  affectedUsers,
  onCancel,
  onConfirm,
  isDeleting,
}: DeleteUserGroupConfirmProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title='确认删除用户组'
      onClose={onCancel}
      onConfirm={onConfirm}
      confirmDisabled={isDeleting}
      confirmText={isDeleting ? '删除中...' : '确认删除'}
      confirmClassName={`px-6 py-2.5 text-sm font-medium ${
        isDeleting ? buttonStyles.disabled : buttonStyles.danger
      }`}
      cancelClassName={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
    >
      <div className='mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20'>
        <div className='mb-2 flex items-center space-x-2'>
          <svg
            className='h-5 w-5 text-red-600 dark:text-red-400'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
            />
          </svg>
          <span className='text-sm font-medium text-red-800 dark:text-red-300'>
            危险操作警告
          </span>
        </div>
        <p className='text-sm text-red-700 dark:text-red-400'>
          删除用户组 <strong>{groupName}</strong>{' '}
          将影响所有使用该组的用户，此操作不可恢复！
        </p>
      </div>

      {affectedUsers.length > 0 ? (
        <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20'>
          <div className='mb-2 flex items-center space-x-2'>
            <svg
              className='h-5 w-5 text-yellow-600 dark:text-yellow-400'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
              />
            </svg>
            <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
              ⚠️ 将影响 {affectedUsers.length} 个用户：
            </span>
          </div>
          <div className='space-y-1'>
            {affectedUsers.map((user, index) => (
              <div
                key={index}
                className='text-sm text-yellow-700 dark:text-yellow-300'
              >
                • {user.username} ({user.role})
              </div>
            ))}
          </div>
          <p className='mt-2 text-xs text-yellow-600 dark:text-yellow-400'>
            这些用户的用户组将被自动移除
          </p>
        </div>
      ) : (
        <div className='rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20'>
          <div className='flex items-center space-x-2'>
            <svg
              className='h-5 w-5 text-green-600 dark:text-green-400'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M5 13l4 4L19 7'
              />
            </svg>
            <span className='text-sm font-medium text-green-800 dark:text-green-300'>
              ✅ 当前没有用户使用此用户组
            </span>
          </div>
        </div>
      )}
    </ConfirmModal>
  );
}
