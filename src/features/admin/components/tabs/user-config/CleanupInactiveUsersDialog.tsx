'use client';

import { ShieldCheck } from 'lucide-react';

import AdminDialog from '@/features/admin/components/AdminDialog';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { formatLastActiveTooltip } from '@/features/admin/lib/userActivity';
import {
  type InactiveCandidate,
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
} from '@/features/admin/services/inactiveUsers';

interface CleanupInactiveUsersDialogProps {
  isOpen: boolean;
  inactiveDays: number;
  candidates: InactiveCandidate[] | null;
  isScanning: boolean;
  isDeleting: boolean;
  onInactiveDaysChange: (next: number) => void;
  onScan: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function CleanupInactiveUsersDialog({
  isOpen,
  inactiveDays,
  candidates,
  isScanning,
  isDeleting,
  onInactiveDaysChange,
  onScan,
  onConfirm,
  onClose,
}: CleanupInactiveUsersDialogProps) {
  const hasCandidates = !!candidates && candidates.length > 0;

  return (
    <AdminDialog
      isOpen={isOpen}
      title='清理不活跃用户'
      onClose={onClose}
      panelClassName='max-w-2xl'
    >
      <div className='space-y-5'>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50'>
          <label
            htmlFor='cleanup-inactive-days'
            className='text-sm text-gray-700 dark:text-gray-300'
          >
            不活跃天数超过
          </label>
          <input
            id='cleanup-inactive-days'
            type='number'
            min={MIN_INACTIVE_DAYS}
            max={MAX_INACTIVE_DAYS}
            value={inactiveDays}
            onChange={(e) => onInactiveDaysChange(Number(e.target.value))}
            className={`w-20 text-sm ${inputStyles.withFocus}`}
          />
          <span className='text-sm text-gray-700 dark:text-gray-300'>天</span>
          <button
            onClick={onScan}
            disabled={isScanning}
            className={`ml-auto px-5 py-2 text-sm font-medium ${
              isScanning ? buttonStyles.disabled : buttonStyles.primary
            }`}
          >
            {isScanning ? '筛选中...' : '筛选'}
          </button>
        </div>

        <p className='flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
          <ShieldCheck className='h-4 w-4 shrink-0 text-green-600 dark:text-green-500' />
          只清理普通用户，站长与管理员不受影响
        </p>

        {candidates &&
          (hasCandidates ? (
            <div className='space-y-2'>
              <p className='text-sm text-gray-700 dark:text-gray-300'>
                匹配到{' '}
                <strong className='text-red-600 dark:text-red-400'>
                  {candidates.length}
                </strong>{' '}
                个用户，确认后永久删除
              </p>
              <div className='max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700'>
                <table className='w-full text-sm'>
                  <thead className='sticky top-0 bg-gray-50 dark:bg-gray-900'>
                    <tr>
                      <th className='px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                        用户名
                      </th>
                      <th className='px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                        不活跃天数
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                    {candidates.map((candidate) => (
                      <tr key={candidate.username}>
                        <td className='px-4 py-2.5 text-gray-900 dark:text-gray-100'>
                          {candidate.username}
                        </td>
                        <td
                          className='px-4 py-2.5 text-right tabular-nums text-gray-500 dark:text-gray-400'
                          title={formatLastActiveTooltip(
                            candidate.lastActiveAt,
                          )}
                        >
                          {candidate.inactiveDays} 天
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className='rounded-xl border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400'>
              没有符合条件的用户
            </p>
          ))}
      </div>

      <div className='mt-6 flex justify-end gap-3'>
        <button
          onClick={onClose}
          className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={!hasCandidates || isDeleting}
          className={`px-6 py-2.5 text-sm font-medium ${
            !hasCandidates || isDeleting
              ? buttonStyles.disabled
              : buttonStyles.danger
          }`}
        >
          {isDeleting
            ? '删除中...'
            : `确认删除${hasCandidates ? ` ${candidates.length} 个用户` : ''}`}
        </button>
      </div>
    </AdminDialog>
  );
}
