'use client';

import { X } from 'lucide-react';

import ModalShell from '@/components/modals/ModalShell';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { DataSource } from '@/features/admin/types/internal';

interface VideoSourceAddFormProps {
  newSource: DataSource;
  isOpen: boolean;
  onChange: (value: DataSource) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function VideoSourceAddForm({
  newSource,
  isOpen,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: VideoSourceAddFormProps) {
  const disabled =
    !newSource.name || !newSource.key || !newSource.api || isSubmitting;

  return (
    <ModalShell isOpen={isOpen} onClose={onCancel} panelClassName='max-w-2xl'>
      <div className='space-y-4 p-6'>
        <div className='flex items-center justify-between'>
          <h5 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
            添加视频源
          </h5>
          <button
            onClick={onCancel}
            aria-label='关闭'
            className='text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
          >
            <X className='h-5 w-5' />
          </button>
        </div>
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
        <div className='flex justify-end space-x-2'>
          <button onClick={onCancel} className={buttonStyles.secondary}>
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled}
            className={disabled ? buttonStyles.disabled : buttonStyles.success}
          >
            {isSubmitting ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
