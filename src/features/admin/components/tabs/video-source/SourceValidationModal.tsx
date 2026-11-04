'use client';

import AdminDialog from '@/features/admin/components/AdminDialog';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';

interface SourceValidationModalProps {
  isOpen: boolean;
  searchKeyword: string;
  onSearchKeywordChange: (value: string) => void;
  onClose: () => void;
  onStart: () => void;
}

export function SourceValidationModal({
  isOpen,
  searchKeyword,
  onSearchKeywordChange,
  onClose,
  onStart,
}: SourceValidationModalProps) {
  return (
    <AdminDialog
      isOpen={isOpen}
      title='视频源有效性检测'
      onClose={onClose}
      panelClassName='max-w-md max-h-[80vh] overflow-y-auto'
    >
      <div className='space-y-4'>
        <input
          type='text'
          placeholder='请输入搜索关键词'
          value={searchKeyword}
          onChange={(e) => onSearchKeywordChange(e.target.value)}
          className={`w-full ${inputStyles.withFocus}`}
          onKeyPress={(e) => e.key === 'Enter' && onStart()}
        />
        <div className='flex justify-end space-x-3'>
          <button onClick={onClose} className={buttonStyles.outline}>
            取消
          </button>
          <button
            onClick={onStart}
            disabled={!searchKeyword.trim()}
            className={`${buttonStyles.primary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            开始检测
          </button>
        </div>
      </div>
    </AdminDialog>
  );
}
