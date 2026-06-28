'use client';

import { useEffect } from 'react';

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const body = document.body;
    const html = document.documentElement;
    const originalBodyOverflow = body.style.overflow;
    const originalHtmlOverflow = html.style.overflow;

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';

    return () => {
      body.style.overflow = originalBodyOverflow;
      html.style.overflow = originalHtmlOverflow;
    };
  }, [active]);
}
