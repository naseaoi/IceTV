import React from 'react';

export function SectionTitle({
  label,
  as: Heading = 'h4',
}: {
  label: string;
  as?: 'h3' | 'h4';
}) {
  return (
    <Heading className='flex min-h-7 shrink-0 items-center gap-2 text-[13px] font-medium text-gray-500 dark:text-gray-400'>
      {label}
    </Heading>
  );
}
