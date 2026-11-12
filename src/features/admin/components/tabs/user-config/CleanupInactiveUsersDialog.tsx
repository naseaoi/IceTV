'use client';

import { useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import AdminDialog from '@/features/admin/components/AdminDialog';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import {
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
} from '@/features/admin/services/inactiveUsers';

interface CleanupInactiveUsersDialogProps {
  isOpen: boolean;
  error?: string;
  inactiveDays: number;
  candidates: { count: number; confirmation: string } | null;
  isScanning: boolean;
  isDeleting: boolean;
  onInactiveDaysChange: (next: number) => void;
  onScan: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function CleanupInactiveUsersDialog({
  isOpen,
  error,
  inactiveDays,
  candidates,
  isScanning,
  isDeleting,
  onInactiveDaysChange,
  onScan,
  onConfirm,
  onClose,
}: CleanupInactiveUsersDialogProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <AdminDialog isOpen={isOpen} title='清理不活跃用户' onClose={onClose}>
        {error && (
          <p role='alert' className='mb-3 text-sm text-red-600'>
            {error}
          </p>
        )}
        <div className='flex flex-wrap items-center gap-3'>
          <label htmlFor='cleanup-inactive-days'>不活跃天数超过</label>
          <input
            id='cleanup-inactive-days'
            type='number'
            min={MIN_INACTIVE_DAYS}
            max={MAX_INACTIVE_DAYS}
            value={inactiveDays}
            onChange={(event) =>
              onInactiveDaysChange(Number(event.target.value))
            }
            className={`w-20 text-sm ${inputStyles.withFocus}`}
          />
          <span>天</span>
          <button
            onClick={onScan}
            disabled={isScanning || isDeleting}
            className={buttonStyles.primary}
          >
            {isScanning ? '筛选中...' : '筛选'}
          </button>
        </div>
        {candidates && (
          <p className='mt-4 text-sm text-gray-600 dark:text-gray-400'>
            匹配到 {candidates.count} 个用户
          </p>
        )}
        <div className='mt-6 flex justify-end gap-3'>
          <button onClick={onClose} className={buttonStyles.outline}>
            取消
          </button>
          <button
            disabled={!candidates?.count || isDeleting || isScanning}
            onClick={() => setConfirming(true)}
            className={buttonStyles.danger}
          >
            清理用户
          </button>
        </div>
      </AdminDialog>
      <ConfirmModal
        isOpen={isOpen && confirming && !!candidates}
        title='确认清理不活跃用户'
        message={`将永久删除 ${candidates?.count || 0} 个用户及其数据。`}
        confirmText='确认删除'
        danger
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onConfirm();
        }}
      />
    </>
  );
}
