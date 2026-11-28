'use client';

import { useEffect } from 'react';

import Spinner from '@/components/Spinner';

type AdminSaveBarProps = {
  saving: boolean;
  onDiscard: () => void;
  message?: string;
  saveLabel?: string;
} & (
  | { formId: string; onSave?: never }
  | { formId?: never; onSave: () => void }
);

// 仅在有未保存改动时挂载，吸附在内容区底部；表单场景经 formId 提交，其余场景传 onSave。
// 挂载期间 Ctrl/Cmd+S 触发保存。
export default function AdminSaveBar({
  saving,
  onDiscard,
  message = '有未保存的改动',
  saveLabel = '保存',
  formId,
  onSave,
}: AdminSaveBarProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 's' ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      if (saving) return;
      if (onSave) {
        onSave();
        return;
      }
      const form = formId && document.getElementById(formId);
      if (form instanceof HTMLFormElement) form.requestSubmit();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [formId, onSave, saving]);

  return (
    <div className='sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mt-4 animate-overlay-in md:bottom-6'>
      <div
        role='region'
        aria-label='未保存的改动'
        className='mx-auto flex max-w-xl items-center gap-3 rounded-xl bg-gray-900 py-2 pl-4 pr-2 text-white shadow-lg ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10'
      >
        <span className='h-2 w-2 shrink-0 rounded-full bg-amber-400' />
        <span className='min-w-0 flex-1 truncate text-sm'>{message}</span>
        <button
          type='button'
          onClick={onDiscard}
          disabled={saving}
          className='h-8 rounded-lg px-3 text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
        >
          放弃
        </button>
        <button
          type={formId ? 'submit' : 'button'}
          form={formId}
          onClick={onSave}
          disabled={saving}
          className='flex h-8 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70'
        >
          {saving && <Spinner className='h-3.5 w-3.5' />}
          {saving ? '保存中' : saveLabel}
        </button>
      </div>
    </div>
  );
}
