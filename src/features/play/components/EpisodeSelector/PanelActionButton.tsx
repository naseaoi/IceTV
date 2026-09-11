'use client';

import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

type PanelActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
};

export function PanelActionButton({
  busy = false,
  disabled,
  children,
  className = '',
  type = 'button',
  ...props
}: PanelActionButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-busy={busy}
      disabled={disabled || busy}
      className={`relative inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-transparent px-2.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700/40 dark:hover:text-gray-100 ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1.5 ${busy ? 'opacity-0' : ''}`}
      >
        {children}
      </span>
      {busy && (
        <LoaderCircle
          aria-hidden='true'
          className='absolute inset-0 m-auto h-3.5 w-3.5 animate-spin'
        />
      )}
    </button>
  );
}
