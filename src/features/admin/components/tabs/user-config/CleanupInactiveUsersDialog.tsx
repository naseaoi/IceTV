'use client';

import AdminDialog from '@/features/admin/components/AdminDialog';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { formatLastActiveTooltip } from '@/features/admin/lib/userActivity';
import {
  type InactiveCandidate,
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
} from '@/features/admin/services/inactiveUsers';

const CHECKBOX_CLASS =
  'h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 accent-blue-600 checked:border-blue-600 checked:bg-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:accent-blue-500 dark:ring-offset-gray-800 dark:checked:border-blue-500 dark:checked:bg-blue-500 dark:focus:ring-blue-600';

interface CleanupInactiveUsersDialogProps {
  isOpen: boolean;
  inactiveDays: number;
  includeNeverActive: boolean;
  candidates: InactiveCandidate[] | null;
  isScanning: boolean;
  isDeleting: boolean;
  onInactiveDaysChange: (next: number) => void;
  onIncludeNeverActiveChange: (next: boolean) => void;
  onScan: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function CleanupInactiveUsersDialog({
  isOpen,
  inactiveDays,
  includeNeverActive,
  candidates,
  isScanning,
  isDeleting,
  onInactiveDaysChange,
  onIncludeNeverActiveChange,
  onScan,
  onConfirm,
  onClose,
}: CleanupInactiveUsersDialogProps) {
  const hasCandidates = !!candidates && candidates.length > 0;
  const neverActiveCount =
    candidates?.filter((candidate) => candidate.lastActiveAt === null).length ||
    0;

  return (
    <AdminDialog
      isOpen={isOpen}
      title='清理不活跃用户'
      onClose={onClose}
      panelClassName='max-w-2xl'
    >
      <div className='mb-6'>
        <div className='mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20'>
          <p className='text-sm text-amber-700 dark:text-amber-400'>
            只清理普通用户，站长与管理员不受影响。
          </p>
        </div>

        <label
          htmlFor='cleanup-inactive-days'
          className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'
        >
          不活跃天数超过：
        </label>
        <div className='flex items-center gap-3'>
          <input
            id='cleanup-inactive-days'
            type='number'
            min={MIN_INACTIVE_DAYS}
            max={MAX_INACTIVE_DAYS}
            value={inactiveDays}
            onChange={(e) => onInactiveDaysChange(Number(e.target.value))}
            className={`w-32 text-sm ${inputStyles.withFocus}`}
          />
          <span className='text-sm text-gray-500 dark:text-gray-400'>天</span>
          <button
            onClick={onScan}
            disabled={isScanning}
            className={`px-4 py-2 text-sm font-medium ${
              isScanning ? buttonStyles.disabled : buttonStyles.primary
            }`}
          >
            {isScanning ? '筛选中...' : '筛选'}
          </button>
        </div>

        <label className='mt-4 flex cursor-pointer items-start gap-2'>
          <input
            type='checkbox'
            checked={includeNeverActive}
            onChange={(e) => onIncludeNeverActiveChange(e.target.checked)}
            className={`mt-0.5 ${CHECKBOX_CLASS}`}
          />
          <span className='text-sm text-gray-700 dark:text-gray-300'>
            同时删除「从未活跃」的用户
            <span className='mt-0.5 block text-xs text-gray-500 dark:text-gray-400'>
              指没有任何活跃记录的旧账号，无法判断注册时长，不受上面的天数限制
            </span>
          </span>
        </label>

        {candidates && (
          <div className='mt-4'>
            {hasCandidates ? (
              <>
                <p className='mb-2 text-sm text-gray-700 dark:text-gray-300'>
                  匹配到 <strong>{candidates.length}</strong> 个用户
                  {neverActiveCount > 0 &&
                    `（其中 ${neverActiveCount} 个从未活跃）`}
                  ，确认后将被
                  <strong className='text-red-600 dark:text-red-400'>
                    永久删除
                  </strong>
                  ：
                </p>
                <div className='max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700'>
                  <table className='w-full text-sm'>
                    <thead className='sticky top-0 bg-gray-50 dark:bg-gray-900'>
                      <tr>
                        <th className='px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400'>
                          用户名
                        </th>
                        <th className='px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400'>
                          不活跃天数
                        </th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                      {candidates.map((candidate) => (
                        <tr key={candidate.username}>
                          <td className='px-4 py-2 text-gray-900 dark:text-gray-100'>
                            {candidate.username}
                          </td>
                          <td
                            className='px-4 py-2 text-gray-500 dark:text-gray-400'
                            title={formatLastActiveTooltip(
                              candidate.lastActiveAt,
                            )}
                          >
                            {candidate.inactiveDays === null
                              ? '从未活跃'
                              : `${candidate.inactiveDays} 天`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                没有符合条件的用户。
              </p>
            )}
          </div>
        )}
      </div>

      <div className='flex justify-end space-x-3'>
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
