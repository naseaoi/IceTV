'use client';

import { type ReactNode } from 'react';

import ModalShell from '@/components/modals/ModalShell';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmDisabled?: boolean;
  confirmClassName?: string;
  cancelClassName?: string;
  containerClassName?: string;
}

export default function ConfirmModal({
  isOpen,
  title,
  onClose,
  onConfirm,
  children,
  confirmText = '确认',
  cancelText = '取消',
  confirmDisabled = false,
  confirmClassName = 'px-6 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors',
  cancelClassName = 'px-6 py-2.5 text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors',
  containerClassName = 'max-w-2xl',
}: ConfirmModalProps) {
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      panelClassName={containerClassName}
    >
      <div className='p-6'>
        <div className='mb-6 flex items-center justify-between'>
          <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
          <button
            onClick={onClose}
            className='text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
          >
            <svg
              className='h-6 w-6'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>

        <div className='mb-6'>{children}</div>

        <div className='flex justify-end space-x-3'>
          <button onClick={onClose} className={cancelClassName}>
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={confirmClassName}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
