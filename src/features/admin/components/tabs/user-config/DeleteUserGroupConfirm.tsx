'use client';

import ConfirmModal from '@/components/modals/ConfirmModal';

interface DeleteUserGroupConfirmProps {
  isOpen: boolean;
  groupName: string;
  affectedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteUserGroupConfirm({
  isOpen,
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
      onClose={onCancel}
      onConfirm={onConfirm}
      confirmDisabled={isDeleting}
      confirmText={isDeleting ? '删除中...' : '确认删除'}
      danger
    />
  );
}
