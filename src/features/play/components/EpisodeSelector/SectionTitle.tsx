import React from 'react';

export function SectionTitle({ label }: { label: string }) {
  return (
    <div className='flex w-full flex-col items-center justify-center gap-0.5 py-1'>
      <h4 className='text-sm font-semibold text-gray-700 dark:text-gray-300'>
        {label}
      </h4>
      <span className='h-0.5 w-7 rounded-full bg-emerald-500/75 dark:bg-emerald-400/75' />
    </div>
  );
}
