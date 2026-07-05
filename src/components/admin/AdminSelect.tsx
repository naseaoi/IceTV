'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface AdminSelectOption {
  label: string;
  value: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface AdminSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AdminSelectOption[];
  placeholder?: string;
  className?: string;
}

export default function AdminSelect({
  value,
  onChange,
  options,
  placeholder = '请选择',
  className = '',
}: AdminSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type='button'
        onClick={() => setIsOpen(!isOpen)}
        className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-left text-sm text-gray-900 shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500'
      >
        <span
          className={selectedOption ? '' : 'text-gray-400 dark:text-gray-500'}
        >
          {selectedOption?.label || placeholder}
        </span>
      </button>

      <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3'>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${isOpen ? 'rotate-180' : ''}`}
        />
      </div>

      {isOpen && (
        <div className='absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800'>
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type='button'
                disabled={opt.disabled}
                title={opt.disabledReason}
                onClick={() => {
                  if (opt.disabled) {
                    return;
                  }
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors duration-150 ${
                  opt.disabled
                    ? 'cursor-not-allowed text-gray-400 dark:text-gray-500'
                    : isSelected
                      ? 'bg-green-50 text-green-600 hover:bg-green-50 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/20'
                      : 'text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span className='flex min-w-0 items-center gap-2'>
                  <span className='truncate'>{opt.label}</span>
                  {opt.disabledReason && (
                    <span className='shrink-0 text-xs text-rose-500 dark:text-rose-400'>
                      {opt.disabledReason}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <Check className='ml-2 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400' />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
