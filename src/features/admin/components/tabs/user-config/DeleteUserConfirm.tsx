'use client';

import ConfirmModal from '@/components/modals/ConfirmModal';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';

interface DeleteUserConfirmProps {
  isOpen: boolean;
  username: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteUserConfirm({
  isOpen,
  username,
  onCancel,
  onConfirm,
}: DeleteUserConfirmProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title='确认删除用户'
      onClose={onCancel}
      onConfirm={onConfirm}
      confirmText='确认删除'
      confirmClassName={`px-6 py-2.5 text-sm font-medium ${buttonStyles.danger}`}
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
          删除用户 <strong>{username}</strong>{' '}
          将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！
        </p>
      </div>
    </ConfirmModal>
  );
}
