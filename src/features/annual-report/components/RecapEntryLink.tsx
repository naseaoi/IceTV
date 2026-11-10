import { Sparkles } from 'lucide-react';
import Link from 'next/link';

export function RecapEntryLink({
  href,
  year,
  className = '',
}: {
  href: string;
  year: number;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full bg-gray-900/[0.05] px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-900/[0.08] hover:text-gray-900 dark:bg-white/[0.06] dark:text-gray-200 dark:hover:bg-white/[0.1] dark:hover:text-white ${className}`}
    >
      <Sparkles className='h-3.5 w-3.5 text-brand-500 dark:text-brand-300' />
      <span className='tabular-nums'>{year}</span> 年度报告
    </Link>
  );
}
