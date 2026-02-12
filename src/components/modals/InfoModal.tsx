'use client';

import { Bell, X } from 'lucide-react';

import ModalShell from '@/components/modals/ModalShell';

interface InfoModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onClose: () => void;
  confirmText?: string;
}

export default function InfoModal({
  isOpen,
  title,
  message,
  onClose,
  confirmText = '我知道了',
}: InfoModalProps) {
  return (
    <ModalShell isOpen={isOpen} onClose={onClose} panelClassName='max-w-md'>
      <div className='p-6 sm:p-7'>
        <div className='mb-5 flex items-start justify-between'>
          <div className='flex items-center gap-3'>
            <span className='inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'>
              <Bell className='h-5 w-5' />
            </span>
            <h3 className='text-xl font-semibold text-slate-900 dark:text-slate-100'>
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className='rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200'
            aria-label='关闭提示'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='rounded-xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3 text-sm leading-7 text-slate-700 dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-teal-500/10 dark:text-slate-200'>
          {message}
        </div>

        <button
          onClick={onClose}
          className='mt-6 w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-medium text-white shadow-md transition-all hover:-translate-y-0.5 hover:from-emerald-500 hover:to-teal-500 hover:shadow-lg'
        >
          {confirmText}
        </button>
      </div>
    </ModalShell>
  );
}
