'use client';

import { Check, Inbox, LoaderCircle, Megaphone, Rss, X } from 'lucide-react';
import { CSSProperties, useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import CoverImage from '@/components/CoverImage';
import { UserMessage, UserMessagePage } from '@/lib/message-types';

import type { MessagePanelAnchor } from './MessageCenterProvider';

interface MessagePanelProps {
  open: boolean;
  anchor?: MessagePanelAnchor;
  page: UserMessagePage;
  loading: boolean;
  loadingMore: boolean;
  workingIds: Set<string>;
  onClose: () => void;
  onRead: (message: UserMessage, navigate?: boolean) => Promise<void>;
  onReadAll: () => Promise<void>;
  onLoadMore: () => Promise<void>;
}

function formatMessageTime(timestamp: number): string {
  if (!timestamp) return '最近';
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 24 * 60 * 60_000) {
    return `${Math.floor(elapsed / (60 * 60_000))} 小时前`;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(timestamp);
}

function MessageRow({
  message,
  working,
  onRead,
}: {
  message: UserMessage;
  working: boolean;
  onRead: (message: UserMessage, navigate?: boolean) => Promise<void>;
}) {
  const isAnnouncement = message.type === 'announcement';

  return (
    <div className='group flex gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-gray-800'>
      {isAnnouncement ? (
        <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/35 dark:text-emerald-300'>
          <Megaphone className='h-5 w-5' />
        </div>
      ) : (
        <div className='relative h-[66px] w-11 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800'>
          <CoverImage
            src={message.cover}
            alt={message.title}
            sizes='44px'
            fallbackLabel='无封面'
          />
        </div>
      )}

      <button
        type='button'
        disabled={working}
        className='min-w-0 flex-1 text-left disabled:opacity-60'
        onClick={() => void onRead(message, !isAnnouncement)}
      >
        <span className='flex items-center gap-1.5'>
          {!isAnnouncement && (
            <Rss className='h-3.5 w-3.5 shrink-0 text-amber-500' />
          )}
          <span className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
            {isAnnouncement ? '站点公告' : message.title}
          </span>
        </span>
        <span className='mt-1 block text-sm leading-5 text-gray-600 dark:text-gray-300'>
          {isAnnouncement
            ? message.content
            : `已从 ${message.fromEpisodes} 集更新至 ${message.toEpisodes} 集`}
        </span>
        <span className='mt-1 block text-xs text-gray-400 dark:text-gray-500'>
          {isAnnouncement ? '公告' : message.sourceName}
          {' · '}
          {formatMessageTime(message.createdAt)}
        </span>
      </button>

      <button
        type='button'
        disabled={working}
        aria-label='标记为已读'
        title='标记为已读'
        className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 opacity-100 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-300 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100'
        onClick={() => void onRead(message)}
      >
        {working ? (
          <LoaderCircle className='h-4 w-4 animate-spin' />
        ) : (
          <Check className='h-4 w-4' />
        )}
      </button>
    </div>
  );
}

export default function MessagePanel({
  open,
  anchor,
  page,
  loading,
  loadingMore,
  workingIds,
  onClose,
  onRead,
  onReadAll,
  onLoadMore,
}: MessagePanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const panelStyle = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const sidebarCollapsed =
      document.documentElement.dataset.sidebarCollapsed === 'true';
    const left = anchor?.right
      ? Math.min(anchor.right + 10, window.innerWidth - 398)
      : sidebarCollapsed
        ? 92
        : 252;
    const bottom = anchor?.top
      ? Math.max(8, window.innerHeight - anchor.top + 8)
      : 16;
    return {
      '--message-panel-left': `${Math.max(8, left)}px`,
      '--message-panel-bottom': `${bottom}px`,
    } as CSSProperties;
  }, [anchor]);

  if (!open || typeof document === 'undefined') return null;
  const readingAll = workingIds.has('all');

  return createPortal(
    <div className='fixed inset-0 z-[1250]' style={panelStyle}>
      <button
        type='button'
        aria-label='关闭消息面板'
        className='absolute inset-0 cursor-default bg-black/45 md:bg-transparent'
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        className='absolute inset-x-0 bottom-0 flex max-h-[82dvh] flex-col rounded-t-xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900 md:bottom-[var(--message-panel-bottom)] md:left-[var(--message-panel-left)] md:right-auto md:max-h-[70vh] md:w-[390px] md:rounded-lg'
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className='mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600 md:hidden' />
        <div className='flex min-h-14 shrink-0 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700'>
          <div className='min-w-0 flex-1'>
            <h2
              id={titleId}
              className='text-base font-semibold text-gray-900 dark:text-gray-100'
            >
              我的消息
            </h2>
            {page.total > 0 && (
              <p className='text-xs text-gray-400'>{page.total} 条未读</p>
            )}
          </div>
          {page.total > 0 && (
            <button
              type='button'
              disabled={readingAll}
              className='text-sm font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50 dark:text-emerald-400 dark:hover:text-emerald-300'
              onClick={() => void onReadAll()}
            >
              全部已读
            </button>
          )}
          <button
            type='button'
            aria-label='关闭'
            title='关闭'
            className='flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'
            onClick={onClose}
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
          {loading && page.items.length === 0 ? (
            <div className='flex min-h-44 items-center justify-center text-gray-400'>
              <LoaderCircle className='h-5 w-5 animate-spin' />
            </div>
          ) : page.items.length === 0 ? (
            <div className='flex min-h-44 flex-col items-center justify-center gap-2 px-4 text-center text-gray-400'>
              <Inbox className='h-9 w-9' />
              <p className='text-sm'>暂无新消息</p>
            </div>
          ) : (
            <>
              {page.items.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  working={readingAll || workingIds.has(message.id)}
                  onRead={onRead}
                />
              ))}
              {page.nextCursor && (
                <div className='flex justify-center px-4 py-3'>
                  <button
                    type='button'
                    disabled={loadingMore}
                    className='text-sm font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50 dark:text-emerald-400'
                    onClick={() => void onLoadMore()}
                  >
                    {loadingMore ? '加载中…' : '加载更多'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
