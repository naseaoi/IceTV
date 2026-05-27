'use client';

import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { LiveDataSource } from '@/features/admin/types/internal';

interface LiveSourceAddFormProps {
  newLiveSource: LiveDataSource;
  onChange: (value: LiveDataSource) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function LiveSourceAddForm({
  newLiveSource,
  onChange,
  onSubmit,
  isSubmitting,
}: LiveSourceAddFormProps) {
  const disabled =
    !newLiveSource.name ||
    !newLiveSource.key ||
    !newLiveSource.url ||
    isSubmitting;

  return (
    <div className='space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <input
          type='text'
          placeholder='名称'
          value={newLiveSource.name}
          onChange={(e) => onChange({ ...newLiveSource, name: e.target.value })}
          className={inputStyles.base}
        />
        <input
          type='text'
          placeholder='Key'
          value={newLiveSource.key}
          onChange={(e) => onChange({ ...newLiveSource, key: e.target.value })}
          className={inputStyles.base}
        />
        <input
          type='text'
          placeholder='M3U 地址'
          value={newLiveSource.url}
          onChange={(e) => onChange({ ...newLiveSource, url: e.target.value })}
          className={inputStyles.base}
        />
        <input
          type='text'
          placeholder='节目单地址（选填）'
          value={newLiveSource.epg}
          onChange={(e) => onChange({ ...newLiveSource, epg: e.target.value })}
          className={inputStyles.base}
        />
        <input
          type='text'
          placeholder='自定义 UA（选填）'
          value={newLiveSource.ua}
          onChange={(e) => onChange({ ...newLiveSource, ua: e.target.value })}
          className={inputStyles.base}
        />
      </div>
      <div className='flex justify-end'>
        <button
          onClick={onSubmit}
          disabled={disabled}
          className={`w-full px-4 py-2 sm:w-auto ${
            disabled ? buttonStyles.disabled : buttonStyles.success
          }`}
        >
          {isSubmitting ? '添加中...' : '添加'}
        </button>
      </div>
    </div>
  );
}
