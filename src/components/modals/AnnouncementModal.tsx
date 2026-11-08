'use client';

import { X } from 'lucide-react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { SiteIcon } from '@/components/SiteIcon';

// 短公告居中排版，多段或较长的公告左对齐保证可读性
const CENTERED_MESSAGE_MAX_LENGTH = 80;

interface AnnouncementModalProps {
  isOpen: boolean;
  message: string;
  onClose: () => void;
  confirmText?: string;
}

export default function AnnouncementModal({
  isOpen,
  message,
  onClose,
  confirmText = '我知道了',
}: AnnouncementModalProps) {
  const centered =
    !message.includes('\n') && message.length <= CENTERED_MESSAGE_MAX_LENGTH;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} panelClassName='max-w-sm'>
      <div className='relative overflow-hidden rounded-2xl'>
        <button
          type='button'
          onClick={onClose}
          className={`${MODAL_CLOSE_BUTTON_CLASS} absolute right-3 top-3`}
          aria-label='关闭公告'
        >
          <X className='h-5 w-5' />
        </button>

        <div className='bg-gradient-to-b from-gray-900/[0.05] to-transparent px-6 pb-4 pt-8 text-center dark:from-white/[0.06]'>
          <span className='inline-flex h-14 w-14 rounded-2xl bg-white p-2.5 shadow-lg shadow-black/[0.06] ring-1 ring-gray-900/[0.06] dark:bg-gray-800 dark:shadow-black/30 dark:ring-white/[0.08]'>
            <SiteIcon />
          </span>
          <h3 className='mt-4 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100'>
            站点公告
          </h3>
        </div>

        <div className='px-6 pb-6'>
          <p
            className={`max-h-[40vh] overflow-y-auto whitespace-pre-line break-words text-[15px] leading-7 text-gray-600 dark:text-gray-300 ${
              centered ? 'text-center' : 'text-left'
            }`}
          >
            {message}
          </p>

          <button
            type='button'
            onClick={onClose}
            className={`${MODAL_PRIMARY_BUTTON_CLASS} mt-6 w-full`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
