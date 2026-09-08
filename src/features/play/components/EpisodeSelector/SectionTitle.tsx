import React from 'react';

export function SectionTitle({
  label,
  as: Heading = 'h4',
}: {
  label: string;
  as?: 'h3' | 'h4';
}) {
  return (
    <Heading className='flex min-h-7 shrink-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100'>
      <span
        aria-hidden='true'
        className='h-3.5 w-[3px] shrink-0 rounded-full bg-green-500 dark:bg-green-400'
      />
      {label}
    </Heading>
  );
}
