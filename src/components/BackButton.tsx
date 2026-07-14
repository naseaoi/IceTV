'use client';

import { ArrowLeft } from 'lucide-react';

import { useBackNavigation } from '@/hooks/useBackNavigation';

interface BackButtonProps {
  variant?: 'default' | 'icon';
  fallbackHref?: string;
}

export function BackButton({
  variant = 'default',
  fallbackHref,
}: BackButtonProps) {
  const goBack = useBackNavigation(fallbackHref);

  if (variant === 'icon') {
    return (
      <button
        type='button'
        onClick={goBack}
        className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/60 text-gray-600 ring-1 ring-black/[0.06] transition-colors hover:bg-gray-100 hover:text-gray-900 dark:bg-white/[0.04] dark:text-gray-300 dark:ring-white/[0.08] dark:hover:bg-white/10 dark:hover:text-white'
        aria-label='返回'
      >
        <ArrowLeft className='h-5 w-5' />
      </button>
    );
  }

  return (
    <button
      type='button'
      onClick={goBack}
      className='flex h-10 w-10 items-center justify-center rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 md:h-auto md:w-auto md:gap-1.5'
      aria-label='返回'
    >
      <ArrowLeft className='h-full w-full md:h-4 md:w-4' />
      <span className='hidden text-xs font-medium md:inline'>返回</span>
    </button>
  );
}
