'use client';

import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface ApiSourcePickerProps {
  sources: DataSource[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** 复选框颜色变体 */
  variant?: 'blue' | 'purple';
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
  variant = 'blue',
}: ApiSourcePickerProps) {
  const colorClass =
    variant === 'purple'
      ? 'text-purple-600 accent-purple-600 checked:border-purple-600 checked:bg-purple-600 focus:ring-purple-500 dark:accent-purple-500 dark:checked:border-purple-500 dark:checked:bg-purple-500'
      : 'text-blue-600 accent-blue-600 checked:border-blue-600 checked:bg-blue-600 focus:ring-blue-500 dark:accent-blue-500 dark:checked:border-blue-500 dark:checked:bg-blue-500';

  const handleToggle = (key: string, checked: boolean) => {
    if (checked) {
      onChange([...selected, key]);
    } else {
      onChange(selected.filter((api) => api !== key));
    }
  };

  const selectAll = () => {
    onChange(sources.filter((s) => !s.disabled).map((s) => s.key));
  };

  const clearAll = () => onChange([]);

  return (
    <>
      <div className='grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3'>
        {sources.map((source) => (
          <label
            key={source.key}
            className='flex cursor-pointer items-center space-x-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
          >
            <input
              type='checkbox'
              checked={selected.includes(source.key)}
              onChange={(e) => handleToggle(source.key, e.target.checked)}
              className={`rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 ${colorClass}`}
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
      <div className='mt-4 flex space-x-2'>
        <button onClick={clearAll} className={buttonStyles.quickAction}>
          全不选（无限制）
        </button>
        <button onClick={selectAll} className={buttonStyles.quickAction}>
          全选
        </button>
      </div>
    </>
  );
}
