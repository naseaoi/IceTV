'use client';

import { FlaskConical, Loader2 } from 'lucide-react';

export function CustomProxyActions({
  isTesting,
  onTest,
}: {
  isTesting: boolean;
  onTest: () => void;
}) {
  return (
    <button
      type='button'
      disabled={isTesting}
      onClick={onTest}
      className='inline-flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
    >
      {isTesting ? (
        <Loader2 className='h-4 w-4 animate-spin' />
      ) : (
        <FlaskConical className='h-4 w-4' />
      )}
      <span>{isTesting ? '测试中' : '测试'}</span>
    </button>
  );
}
