'use client';

import Spinner from '@/components/Spinner';

interface AdminSaveBarProps {
  formId: string;
  saving: boolean;
  onDiscard: () => void;
}

// 仅在表单有改动时挂载，吸附在内容区底部
export default function AdminSaveBar({
  formId,
  saving,
  onDiscard,
}: AdminSaveBarProps) {
  return (
    <div className='sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mt-4 animate-overlay-in md:bottom-6'>
      <div
        role='region'
        aria-label='未保存的改动'
        className='mx-auto flex max-w-xl items-center gap-3 rounded-xl bg-gray-900 py-2 pl-4 pr-2 text-white shadow-lg ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10'
      >
        <span className='h-2 w-2 shrink-0 rounded-full bg-amber-400' />
        <span className='min-w-0 flex-1 truncate text-sm'>有未保存的改动</span>
        <button
          type='button'
          onClick={onDiscard}
          disabled={saving}
          className='h-8 rounded-lg px-3 text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
        >
          放弃
        </button>
        <button
          type='submit'
          form={formId}
          disabled={saving}
          className='flex h-8 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70'
        >
          {saving && <Spinner className='h-3.5 w-3.5' />}
          {saving ? '保存中' : '保存'}
        </button>
      </div>
    </div>
  );
}
