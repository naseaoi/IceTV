import React, { type ReactNode } from 'react';

export function SectionTitle({
  label,
  as: Heading = 'h4',
  count,
  children,
}: {
  label: string;
  as?: 'h3' | 'h4';
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className='flex min-h-9 shrink-0 items-center gap-2'>
      <Heading className='text-[15px] font-semibold text-gray-900 dark:text-gray-50'>
        {label}
      </Heading>
      {count !== undefined && count > 0 && (
        <span className='text-[13px] tabular-nums text-gray-400 dark:text-gray-500'>
          {count}
        </span>
      )}
      {children && (
        <div className='-mr-2 ml-auto flex items-center gap-0.5'>
          {children}
        </div>
      )}
    </div>
  );
}
