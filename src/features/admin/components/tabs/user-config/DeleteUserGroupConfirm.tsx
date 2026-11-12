'use client';

import ConfirmModal from '@/components/modals/ConfirmModal';

interface DeleteUserGroupConfirmProps {
  isOpen: boolean;
  error?: string;
  groupName: string;
  affectedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteUserGroupConfirm({
  isOpen,
  error,
  groupName,
  affectedCount,
  onCancel,
  onConfirm,
  isDeleting,
}: DeleteUserGroupConfirmProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title='确认删除用户组'
      message={`删除「${groupName}」将移除 ${affectedCount} 个用户的该组归属。`}
      onClose={() => {
        if (!isDeleting) onCancel();
      }}
      onConfirm={onConfirm}
      confirmDisabled={isDeleting}
      confirmText={isDeleting ? '删除中...' : '确认删除'}
      danger
    >
      <p>
        删除「{groupName}」将移除 {affectedCount} 个用户的该组归属。
      </p>
      {error && (
        <p role='alert' className='mt-3 text-sm text-red-600'>
          {error}
        </p>
      )}
    </ConfirmModal>
  );
}
