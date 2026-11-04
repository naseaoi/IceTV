'use client';

import { X } from 'lucide-react';

import AdminSelect from '@/components/admin/AdminSelect';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { CustomCategory } from '@/features/admin/types/internal';

interface CategoryAddFormProps {
  newCategory: CustomCategory;
  isOpen: boolean;
  typeOptions: { value: string; label: string }[];
  onChange: (value: CustomCategory) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function CategoryAddForm({
  newCategory,
  isOpen,
  typeOptions,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: CategoryAddFormProps) {
  const disabled = !newCategory.name || !newCategory.query || isSubmitting;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      panelClassName='max-w-2xl max-h-[80vh] overflow-y-auto'
    >
      <div className='space-y-4 p-4 sm:p-6'>
        <div className='flex items-start justify-between gap-3'>
          <h5 className={MODAL_TITLE_CLASS}>添加分类</h5>
          <button
            onClick={onCancel}
            aria-label='关闭'
            className={MODAL_CLOSE_BUTTON_CLASS}
          >
            <X className='h-5 w-5' />
          </button>
        </div>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <input
            type='text'
            placeholder='分类名称'
            value={newCategory.name}
            onChange={(e) => onChange({ ...newCategory, name: e.target.value })}
            className={inputStyles.withFocus}
          />
          <AdminSelect
            value={newCategory.type}
            onChange={(value) =>
              onChange({ ...newCategory, type: value as 'movie' | 'tv' })
            }
            options={typeOptions}
          />
          <input
            type='text'
            placeholder='搜索关键词'
            value={newCategory.query}
            onChange={(e) =>
              onChange({ ...newCategory, query: e.target.value })
            }
            className={inputStyles.withFocus}
          />
        </div>
        <div className='flex justify-end space-x-2'>
          <button onClick={onCancel} className={buttonStyles.outline}>
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled}
            className={`${buttonStyles.primary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isSubmitting ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
