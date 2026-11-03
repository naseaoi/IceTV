'use client';

import { ChevronUp } from 'lucide-react';

import { scrollPageToTop, usePageScrolled } from '@/hooks/usePageScroll';

const SHOW_SCROLL_TOP_THRESHOLD = 360;

export function ScrollToTopButton() {
  const visible = usePageScrolled(SHOW_SCROLL_TOP_THRESHOLD);

  return (
    <button
      type='button'
      onClick={() => scrollPageToTop()}
      className={`group fixed bottom-20 right-5 z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/90 text-white shadow-lg ring-1 ring-white/20 backdrop-blur-sm transition-all duration-300 ease-in-out hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300 md:bottom-8 md:right-8 md:h-12 md:w-12 ${
        visible
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-4 opacity-0'
      }`}
      aria-label='返回顶部'
    >
      <ChevronUp className='h-5 w-5 transition-transform group-hover:scale-110 md:h-6 md:w-6' />
    </button>
  );
}
