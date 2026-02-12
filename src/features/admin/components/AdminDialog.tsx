'use client';

import { X } from 'lucide-react';
import { type ReactNode } from 'react';

import ModalShell from '@/components/modals/ModalShell';

interface AdminDialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
}

export default function AdminDialog({
  isOpen,
  title,
  onClose,
  children,
  panelClassName = 'max-w-4xl max-h-[80vh] overflow-y-auto',
  bodyClassName,
}: AdminDialogProps) {
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      panelClassName={panelClassName}
    >
      <div className='p-6'>
        <div className='mb-6 flex items-center justify-between'>
          <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
          <button
            onClick={onClose}
            className='text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
            aria-label='关闭弹窗'
          >
            <X className='h-6 w-6' />
          </button>
        </div>

        <div className={bodyClassName}>{children}</div>
      </div>
    </ModalShell>
  );
}
