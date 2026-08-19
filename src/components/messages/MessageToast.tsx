'use client';

import { Bell, X } from 'lucide-react';

export default function MessageToast({
  text,
  onOpen,
  onClose,
}: {
  text: string | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  if (!text) return null;

  return (
    <div
      role='status'
      className='fixed inset-x-3 top-[calc(3.5rem+env(safe-area-inset-top))] z-[1300] mx-auto flex max-w-sm items-center gap-3 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 shadow-xl dark:border-emerald-800/70 dark:bg-gray-900 md:inset-x-auto md:right-5 md:top-5 md:mx-0 md:w-[360px]'
    >
      <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'>
        <Bell className='h-[18px] w-[18px]' />
      </span>
      <button
        type='button'
        className='min-w-0 flex-1 text-left text-sm font-medium text-gray-800 dark:text-gray-100'
        onClick={onOpen}
      >
        <span className='line-clamp-2'>{text}</span>
      </button>
      <button
        type='button'
        aria-label='关闭消息提示'
        title='关闭'
        className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'
        onClick={onClose}
      >
        <X className='h-4 w-4' />
      </button>
    </div>
  );
}
