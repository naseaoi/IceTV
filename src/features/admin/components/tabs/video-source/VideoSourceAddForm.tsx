'use client';

import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface VideoSourceAddFormProps {
  newSource: DataSource;
  onChange: (value: DataSource) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function VideoSourceAddForm({
  newSource,
  onChange,
  onSubmit,
  isSubmitting,
}: VideoSourceAddFormProps) {
  const disabled =
    !newSource.name || !newSource.key || !newSource.api || isSubmitting;

  return (
    <div className='space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <input
          type='text'
          placeholder='名称'
          value={newSource.name}
          onChange={(e) => onChange({ ...newSource, name: e.target.value })}
          className={inputStyles.base}
        />
        <input
          type='text'
          placeholder='Key'
          value={newSource.key}
          onChange={(e) => onChange({ ...newSource, key: e.target.value })}
          className={inputStyles.base}
        />
        <input
          type='text'
          placeholder='API 地址'
          value={newSource.api}
          onChange={(e) => onChange({ ...newSource, api: e.target.value })}
          className={inputStyles.base}
        />
        <input
          type='text'
          placeholder='Detail 地址（选填）'
          value={newSource.detail}
          onChange={(e) => onChange({ ...newSource, detail: e.target.value })}
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
