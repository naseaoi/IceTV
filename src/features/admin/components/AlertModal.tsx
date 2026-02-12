'use client';

import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import { useEffect } from 'react';

import ModalShell from '@/components/modals/ModalShell';
import { type AlertType } from '@/features/admin/hooks/useAlertModal';

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: AlertType;
  title: string;
  message?: string;
  html?: string;
  timer?: number;
  showConfirm?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
}

export default function AlertModal({
  isOpen,
  onClose,
  type,
  title,
  message,
  html,
  timer,
  showConfirm = false,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
}: AlertModalProps) {
  useEffect(() => {
    if (!isOpen || !timer) {
      return;
    }

    const timeout = window.setTimeout(() => {
      onClose();
    }, timer);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isOpen, timer, onClose]);

  const toneClassName =
    type === 'success'
      ? 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
      : type === 'error'
        ? 'border-rose-200/80 bg-rose-50/80 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
        : 'border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300';

  const icon =
    type === 'success' ? (
      <CheckCircle className='h-6 w-6' />
    ) : type === 'error' ? (
      <AlertCircle className='h-6 w-6' />
    ) : (
      <AlertTriangle className='h-6 w-6' />
    );

  const shouldShowSingleCloseButton = showConfirm && !onConfirm;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} panelClassName='max-w-md'>
      <div className='p-6 sm:p-7'>
        <div className='mb-5 flex items-start gap-3'>
          <span
            className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${toneClassName}`}
          >
            {icon}
          </span>
          <div>
            <h3 className='text-lg font-semibold text-slate-900 dark:text-slate-100'>
              {title}
            </h3>
            {message && (
              <p className='mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300'>
                {message}
              </p>
            )}
          </div>
        </div>

        {html && (
          <div
            className='mb-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200'
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        {(shouldShowSingleCloseButton || (showConfirm && onConfirm)) && (
          <div className='mt-6 flex justify-end gap-3'>
            {showConfirm && onConfirm && (
              <button
                onClick={onClose}
                className='rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={() => {
                if (onConfirm) {
                  onConfirm();
                }
                onClose();
              }}
              className='rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500'
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
