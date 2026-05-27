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
      panelClassName='max-w-md'
    >
      <p className='mb-4 text-sm text-gray-600 dark:text-gray-400'>
        请输入检测用的搜索关键词
      </p>
      <div className='space-y-4'>
        <input
          type='text'
          placeholder='请输入搜索关键词'
          value={searchKeyword}
          onChange={(e) => onSearchKeywordChange(e.target.value)}
          className={`w-full ${inputStyles.base}`}
          onKeyPress={(e) => e.key === 'Enter' && onStart()}
        />
        <div className='flex justify-end space-x-3'>
          <button
            onClick={onClose}
            className='px-4 py-2 text-gray-600 transition-colors hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          >
            取消
          </button>
          <button
            onClick={onStart}
            disabled={!searchKeyword.trim()}
            className={`px-4 py-2 ${
              !searchKeyword.trim()
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            开始检测
          </button>
        </div>
      </div>
    </AdminDialog>
  );
}
