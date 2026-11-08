'use client';

import { Search, X } from 'lucide-react';
import { useRef } from 'react';

interface AdminSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}

export default function AdminSearchField({
  value,
  onChange,
  label,
  className = '',
}: AdminSearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <label
      className={`group relative flex h-9 items-center rounded-lg bg-white ring-1 ring-inset ring-gray-200 transition focus-within:ring-2 focus-within:ring-brand-500 dark:bg-gray-900 dark:ring-gray-700 ${className}`}
    >
      <Search
        aria-hidden='true'
        className='pointer-events-none absolute left-3 h-4 w-4 text-gray-400 transition group-focus-within:text-brand-500'
      />
      <input
        ref={inputRef}
        type='search'
        aria-label={label}
        placeholder={label}
        value={value}
        autoComplete='off'
        enterKeyHint='search'
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) onChange('');
        }}
        className='h-full w-full border-0 bg-transparent py-0 pl-9 pr-9 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0 dark:text-gray-100 [&::-webkit-search-cancel-button]:hidden'
      />
      {value && (
        <button
          type='button'
          aria-label='清除搜索'
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className='absolute right-2 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200'
        >
          <X aria-hidden='true' className='h-3.5 w-3.5' />
        </button>
      )}
    </label>
  );
}
