'use client';

import { useEffect, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import {
  MODAL_DANGER_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_LABEL_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
} from '@/components/modals/modal-styles';
import Spinner from '@/components/Spinner';
import AdminDialog from '@/features/admin/components/AdminDialog';
import {
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
} from '@/features/admin/services/inactiveUsers';
import { getErrorMessage } from '@/lib/user-facing-error';

const DEFAULT_INACTIVE_DAYS = 90;
const PREVIEW_DEBOUNCE_MS = 300;

interface InactiveUsersPreview {
  count: number;
  confirmation: string;
}

interface CleanupInactiveUsersDialogProps {
  isOpen: boolean;
  error?: string;
  isDeleting: boolean;
  onPreview: (inactiveDays: number) => Promise<InactiveUsersPreview>;
  onConfirm: (inactiveDays: number, confirmation: string) => void;
  onClose: () => void;
}

function parseInactiveDays(draft: string) {
  const days = Number(draft);
  return /^\d+$/.test(draft) &&
    days >= MIN_INACTIVE_DAYS &&
    days <= MAX_INACTIVE_DAYS
    ? days
    : null;
}

export function CleanupInactiveUsersDialog({
  isOpen,
  error,
  isDeleting,
  onPreview,
  onConfirm,
  onClose,
}: CleanupInactiveUsersDialogProps) {
  const [draft, setDraft] = useState(String(DEFAULT_INACTIVE_DAYS));
  const [preview, setPreview] = useState<InactiveUsersPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const days = parseInactiveDays(draft.trim());

  // 天数变化即重新统计；旧请求的结果被丢弃，确认凭据始终对应当前天数
  useEffect(() => {
    setPreview(null);
    setPreviewError('');
    if (!isOpen || days === null) return;
    let active = true;
    const timer = window.setTimeout(() => {
      onPreview(days).then(
        (result) => {
          if (active) setPreview(result);
        },
        (reason) => {
          if (active)
            setPreviewError(getErrorMessage(reason, '筛选不活跃用户失败'));
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, days, onPreview]);

  const scanning = days !== null && !preview && !previewError;
  const count = preview?.count ?? 0;

  return (
    <>
      <AdminDialog
        isOpen={isOpen}
        title='清理不活跃用户'
        onClose={onClose}
        panelClassName='max-w-sm'
      >
        <label htmlFor='cleanup-inactive-days' className={MODAL_LABEL_CLASS}>
          未活跃天数超过
        </label>
        <div className='relative'>
          <input
            id='cleanup-inactive-days'
            type='number'
            inputMode='numeric'
            min={MIN_INACTIVE_DAYS}
            max={MAX_INACTIVE_DAYS}
            value={draft}
            disabled={isDeleting}
            aria-invalid={days === null}
            onChange={(event) => setDraft(event.target.value)}
            className={`${MODAL_INPUT_CLASS} pr-10 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
          />
          <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500 dark:text-gray-400'>
            天
          </span>
        </div>

        <div className='mt-4 flex h-24 flex-col items-center justify-center rounded-xl bg-gray-900/[0.03] px-4 text-center dark:bg-white/[0.04]'>
          {days === null ? (
            <p
              role='alert'
              className='text-sm text-rose-600 dark:text-rose-400'
            >
              请输入 {MIN_INACTIVE_DAYS}–{MAX_INACTIVE_DAYS} 之间的整数
            </p>
          ) : previewError ? (
            <p
              role='alert'
              className='text-sm text-rose-600 dark:text-rose-400'
            >
              {previewError}
            </p>
          ) : scanning ? (
            <div
              role='status'
              aria-label='正在筛选用户'
              className='flex flex-col items-center gap-2 text-sm text-gray-400 dark:text-gray-500'
            >
              <Spinner className='h-7 w-7 text-brand-500 dark:text-brand-400' />
              正在筛选
            </div>
          ) : (
            <>
              <p
                className={`text-3xl font-semibold tabular-nums leading-9 ${
                  count > 0
                    ? 'text-gray-900 dark:text-gray-100'
                    : 'text-gray-300 dark:text-gray-600'
                }`}
              >
                {count}
              </p>
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                {count > 0
                  ? `个用户超过 ${days} 天未活跃`
                  : '没有符合条件的用户'}
              </p>
            </>
          )}
        </div>

        {error && (
          <p
            role='alert'
            className='mt-3 text-sm text-rose-600 dark:text-rose-400'
          >
            {error}
          </p>
        )}

        <div className='mt-6 flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className={MODAL_SECONDARY_BUTTON_CLASS}
          >
            取消
          </button>
          <button
            type='button'
            disabled={count === 0 || isDeleting}
            onClick={() => setConfirming(true)}
            className={MODAL_DANGER_BUTTON_CLASS}
          >
            {isDeleting && <Spinner className='mr-2 h-4 w-4' />}
            {count > 0 ? `清理 ${count} 个用户` : '清理用户'}
          </button>
        </div>
      </AdminDialog>
      <ConfirmModal
        isOpen={isOpen && confirming && !!preview}
        title='确认清理不活跃用户'
        message={`将永久删除 ${count} 个用户及其数据，无法恢复。`}
        confirmText='确认删除'
        danger
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (days !== null && preview) onConfirm(days, preview.confirmation);
        }}
      />
    </>
  );
}
