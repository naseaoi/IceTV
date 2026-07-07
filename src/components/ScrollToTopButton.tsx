'use client';

import { ChevronUp } from 'lucide-react';
import { useEffect, useState } from 'react';

const SHOW_SCROLL_TOP_THRESHOLD = 360;

function getPageScrollTop() {
  return (
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
}

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(getPageScrollTop() > SHOW_SCROLL_TOP_THRESHOLD);
    };
    const scrollOptions: AddEventListenerOptions = { passive: true };
    const scrollTargets = [window, document.documentElement, document.body];

    handleScroll();
    scrollTargets.forEach((target) => {
      target.addEventListener('scroll', handleScroll, scrollOptions);
    });

    return () => {
      scrollTargets.forEach((target) => {
        target.removeEventListener('scroll', handleScroll);
      });
    };
  }, []);

  const scrollToTop = () => {
    const options: ScrollToOptions = { top: 0, behavior: 'smooth' };

    window.scrollTo(options);
    if (document.documentElement.scrollTo) {
      document.documentElement.scrollTo(options);
    } else {
      document.documentElement.scrollTop = 0;
    }
    if (document.body.scrollTo) {
      document.body.scrollTo(options);
    } else {
      document.body.scrollTop = 0;
    }
  };

  return (
    <button
      type='button'
      onClick={scrollToTop}
      className={`group fixed bottom-20 right-5 z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-green-500/90 text-white shadow-lg ring-1 ring-white/20 backdrop-blur-sm transition-all duration-300 ease-in-out hover:bg-green-500 focus:outline-none focus:ring-2 focus:ring-green-300 md:bottom-8 md:right-8 md:h-12 md:w-12 ${
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
