'use client';

import { RotateCcw, Trash2, X } from 'lucide-react';

import Spinner from '@/components/Spinner';
import { WATCH_STATUS_OPTIONS } from '@/components/watch-record-context';
import type { FavoriteWatchStatus } from '@/lib/types';

export type FavoriteBatchCommand = FavoriteWatchStatus | 'auto' | 'remove';

const ACTION_CLASS =
  'flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-gray-200 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 sm:flex-none';

export function FavoriteSelectionBar({
  count,
  allSelected,
  busy,
  error,
  onToggleAll,
  onCommand,
  onClose,
}: {
  count: number;
  allSelected: boolean;
  busy: FavoriteBatchCommand | null;
  error: string;
  onToggleAll: () => void;
  onCommand: (command: FavoriteBatchCommand) => void;
  onClose: () => void;
}) {
  const disabled = count === 0 || busy !== null;
  const icon = (command: FavoriteBatchCommand) =>
    busy === command ? <Spinner className='h-3.5 w-3.5' /> : null;

  return (
    <div className='pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 md:bottom-6'>
      <div
        role='toolbar'
        aria-label='批量操作'
        className='pointer-events-auto flex w-full max-w-2xl animate-overlay-in flex-wrap items-center gap-x-1 gap-y-1.5 rounded-2xl bg-gray-900 p-1.5 text-white shadow-xl ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10 sm:w-auto sm:flex-nowrap'
      >
        <button
          type='button'
          aria-label='退出多选'
          onClick={onClose}
          className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/10 hover:text-white'
        >
          <X aria-hidden='true' className='h-4 w-4' />
        </button>
        <span
          aria-live='polite'
          className='min-w-0 flex-1 truncate px-1 text-sm tabular-nums sm:w-24 sm:flex-none'
        >
          {error ? (
            <span className='text-red-300'>{error}</span>
          ) : (
            `已选 ${count} 部`
          )}
        </span>
        <button
          type='button'
          onClick={onToggleAll}
          disabled={busy !== null}
          className='h-8 min-w-[4.75rem] shrink-0 rounded-lg px-2.5 text-[13px] font-medium text-brand-300 transition-colors hover:bg-white/10 hover:text-brand-200 disabled:opacity-40'
        >
          {allSelected ? '取消全选' : '全选'}
        </button>
        <span
          aria-hidden='true'
          className='mx-1 hidden h-5 w-px bg-white/15 sm:block'
        />
        <div className='flex basis-full items-center gap-1 sm:basis-auto'>
          {WATCH_STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type='button'
              disabled={disabled}
              onClick={() => onCommand(option.value)}
              className={ACTION_CLASS}
            >
              {icon(option.value)}
              {option.label}
            </button>
          ))}
          <button
            type='button'
            title='恢复自动判断状态'
            disabled={disabled}
            onClick={() => onCommand('auto')}
            className={ACTION_CLASS}
          >
            {icon('auto') ?? (
              <RotateCcw aria-hidden='true' className='h-3.5 w-3.5' />
            )}
            自动
          </button>
          <button
            type='button'
            disabled={disabled}
            onClick={() => onCommand('remove')}
            className={`${ACTION_CLASS} text-red-300 hover:bg-red-500/15 hover:text-red-200`}
          >
            {icon('remove') ?? (
              <Trash2 aria-hidden='true' className='h-3.5 w-3.5' />
            )}
            移出
          </button>
        </div>
      </div>
    </div>
  );
}
