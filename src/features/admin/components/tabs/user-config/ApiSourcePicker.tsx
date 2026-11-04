'use client';

import { checkboxStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface ApiSourcePickerProps {
  sources: DataSource[];
  selected: string[];
  onChange: (next: string[]) => void;
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

export function ApiSourcePicker({
  sources,
  selected,
  onChange,
}: ApiSourcePickerProps) {
  const handleToggle = (key: string, checked: boolean) => {
    if (checked) {
      onChange([...selected, key]);
    } else {
      onChange(selected.filter((api) => api !== key));
    }
  };

  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
      {sources.map((source) => (
        <label
          key={source.key}
          className='flex min-w-0 cursor-pointer items-center space-x-3 rounded-lg bg-white p-3 ring-1 ring-inset ring-gray-200 transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:ring-white/[0.06] dark:hover:bg-gray-800'
        >
          <input
            type='checkbox'
            checked={selected.includes(source.key)}
            onChange={(e) => handleToggle(source.key, e.target.checked)}
            className={checkboxStyles}
          />
          <div className='min-w-0 flex-1'>
            <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
              {source.name}
            </div>
            {source.api && (
              <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                {extractDomain(source.api)}
              </div>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}
