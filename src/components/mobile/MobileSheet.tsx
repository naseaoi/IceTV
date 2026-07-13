'use client';

import { X } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface MobileSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export default function MobileSheet({
  open,
  title,
  onClose,
  children,
  footer,
}: MobileSheetProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className='fixed inset-0 z-[1200] md:hidden'>
      <div
        className='absolute inset-0 bg-black/50'
        aria-hidden='true'
        onClick={onClose}
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className='absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-2xl bg-white dark:bg-gray-900'
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className='mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600' />
        <div className='flex shrink-0 items-center justify-between px-4 py-3'>
          <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
          <button
            type='button'
            aria-label='关闭'
            className='flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            onClick={onClose}
          >
            <X className='h-5 w-5' />
          </button>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-4 pb-4'>
          {children}
        </div>
        {footer && (
          <div className='shrink-0 border-t border-gray-200 px-4 py-3 dark:border-gray-700'>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
