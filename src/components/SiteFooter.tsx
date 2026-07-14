'use client';

import { useSite } from '@/components/SiteProvider';
import { DEFAULT_SITE_FOOTER_TEXT } from '@/lib/site-footer';

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const { footerText } = useSite();
  const text = footerText || DEFAULT_SITE_FOOTER_TEXT;

  return (
    <footer
      className={`relative px-4 text-center text-xs leading-6 text-gray-500 dark:text-gray-500 ${
        compact ? 'mt-2 py-2' : 'mt-6 pb-2 pt-4 sm:mt-8'
      }`}
    >
      <div className='pointer-events-none absolute left-1/2 top-0 h-px w-full max-w-4xl -translate-x-1/2 bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/10' />
      <p className='mx-auto max-w-4xl whitespace-pre-line'>{text}</p>
    </footer>
  );
}
