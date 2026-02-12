'use client';

import { AlertTriangle } from 'lucide-react';

import ModalShell from '@/components/modals/ModalShell';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  onCancel,
  onConfirm,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
}: ConfirmModalProps) {
  const confirmClassName = danger
    ? 'bg-rose-600 hover:bg-rose-500'
    : 'bg-blue-600 hover:bg-blue-500';

  return (
    <ModalShell isOpen={isOpen} onClose={onCancel} panelClassName='max-w-md'>
      <div className='p-6 sm:p-7'>
        <div className='mb-4 flex items-start gap-3'>
          <span className='mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300'>
            <AlertTriangle className='h-5 w-5' />
          </span>
          <div>
            <h3 className='text-lg font-semibold text-slate-900 dark:text-slate-100'>
              {title}
            </h3>
            <p className='mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300'>
              {message}
            </p>
          </div>
        </div>

        <div className='mt-6 flex justify-end gap-3'>
          <button
            onClick={onCancel}
            className='rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors ${confirmClassName}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
