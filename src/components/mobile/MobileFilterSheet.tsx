'use client';

import { ReactNode } from 'react';

import MobileSheet from '@/components/mobile/MobileSheet';

interface MobileFilterSheetProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
}

export default function MobileFilterSheet({
  open,
  title = '筛选',
  onClose,
  children,
}: MobileFilterSheetProps) {
  return (
    <MobileSheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <button
          type='button'
          className='h-11 w-full rounded-xl bg-green-600 text-sm font-semibold text-white hover:bg-green-700'
          onClick={onClose}
        >
          完成
        </button>
      }
    >
      {children}
    </MobileSheet>
  );
}
