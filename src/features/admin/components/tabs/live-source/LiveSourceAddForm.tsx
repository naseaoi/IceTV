'use client';

import { X } from 'lucide-react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { LiveDataSource } from '@/features/admin/types/internal';

interface LiveSourceAddFormProps {
  newLiveSource: LiveDataSource;
  isOpen: boolean;
  onChange: (value: LiveDataSource) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function LiveSourceAddForm({
  newLiveSource,
  isOpen,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: LiveSourceAddFormProps) {
  const disabled =
    !newLiveSource.name ||
    !newLiveSource.key ||
    !newLiveSource.url ||
    isSubmitting;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      panelClassName='max-w-2xl max-h-[80vh] overflow-y-auto'
    >
      <div className='space-y-4 p-4 sm:p-6'>
        <div className='flex items-start justify-between gap-3'>
          <h5 className={MODAL_TITLE_CLASS}>添加直播源</h5>
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
            placeholder='名称'
            value={newLiveSource.name}
            onChange={(e) =>
              onChange({ ...newLiveSource, name: e.target.value })
            }
            className={inputStyles.withFocus}
          />
          <input
            type='text'
            placeholder='Key'
            value={newLiveSource.key}
            onChange={(e) =>
              onChange({ ...newLiveSource, key: e.target.value })
            }
            className={inputStyles.withFocus}
          />
          <input
            type='text'
            placeholder='M3U 地址'
            value={newLiveSource.url}
            onChange={(e) =>
              onChange({ ...newLiveSource, url: e.target.value })
            }
            className={inputStyles.withFocus}
          />
          <input
            type='text'
            placeholder='节目单地址（选填）'
            value={newLiveSource.epg}
            onChange={(e) =>
              onChange({ ...newLiveSource, epg: e.target.value })
            }
            className={inputStyles.withFocus}
          />
          <input
            type='text'
            placeholder='自定义 UA（选填）'
            value={newLiveSource.ua}
            onChange={(e) => onChange({ ...newLiveSource, ua: e.target.value })}
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
