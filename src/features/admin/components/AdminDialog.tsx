'use client';

import { X } from 'lucide-react';
import { type ReactNode } from 'react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
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
      <div className='p-4 sm:p-6'>
        <div className='mb-4 flex items-start justify-between gap-3'>
          <h3 className={MODAL_TITLE_CLASS}>{title}</h3>
          <button
            onClick={onClose}
            className={MODAL_CLOSE_BUTTON_CLASS}
            aria-label='关闭弹窗'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className={bodyClassName}>{children}</div>
      </div>
    </ModalShell>
  );
}
