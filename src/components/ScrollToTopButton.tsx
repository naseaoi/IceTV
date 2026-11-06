'use client';

import { ChevronUp } from 'lucide-react';

import { FLOATING_CONTROL_CLASS } from '@/components/floating-control';
import { scrollPageToTop, usePageScrolled } from '@/hooks/usePageScroll';

const SHOW_SCROLL_TOP_THRESHOLD = 360;

export function ScrollToTopButton() {
  const visible = usePageScrolled(SHOW_SCROLL_TOP_THRESHOLD);

  return (
    <button
      type='button'
      onClick={() => scrollPageToTop()}
      className={`${FLOATING_CONTROL_CLASS} fixed bottom-20 right-5 z-[500] h-11 w-11 duration-300 ease-in-out md:bottom-8 md:right-8 ${
        visible
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-4 opacity-0'
      }`}
      aria-label='返回顶部'
    >
      <ChevronUp className='h-5 w-5' />
    </button>
  );
}
