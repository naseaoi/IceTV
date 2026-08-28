'use client';

import {
  Check,
  Inbox,
  LoaderCircle,
  Megaphone,
  RefreshCw,
  Rss,
  X,
} from 'lucide-react';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

import CoverImage from '@/components/CoverImage';
import { useBodyScrollLock } from '@/components/user-menu/useBodyScrollLock';
import { UserMessage, UserMessagePage } from '@/lib/message-types';

interface MessagePanelProps {
  open: boolean;
  page: UserMessagePage;
  loading: boolean;
  loadingMore: boolean;
  loadError: string | null;
  workingIds: Set<string>;
  onClose: () => void;
  onRead: (message: UserMessage) => Promise<void>;
  onReadAll: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  onRetry: () => Promise<void>;
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
  onRead: (message: UserMessage) => Promise<void>;
}) {
  const isAnnouncement = message.type === 'announcement';

  return (
    <div
      className={`group flex gap-3 rounded-lg border p-3 sm:p-4 ${
        isAnnouncement
          ? 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-800/60 dark:bg-emerald-950/25'
          : 'border-gray-200/80 bg-white/60 dark:border-gray-700/80 dark:bg-gray-800/40'
      }`}
    >
      {isAnnouncement ? (
        <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/35 dark:text-emerald-300'>
          <Megaphone className='h-5 w-5' />
        </div>
      ) : (
        <div className='relative h-[72px] w-12 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800'>
          <CoverImage
            src={message.cover}
            alt={message.title}
            fallbackLabel='无封面'
            checkClientCacheBeforeLoad
          />
        </div>
      )}

      <div className='min-w-0 flex-1'>
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
      </div>

      <button
        type='button'
        disabled={working}
        aria-label='标记为已读'
        title='标记为已读'
        className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-emerald-100/80 hover:text-emerald-700 disabled:opacity-50 dark:hover:bg-emerald-900/50 dark:hover:text-emerald-300'
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

function MessageSection({
  title,
  messages,
  workingIds,
  readingAll,
  onRead,
}: {
  title: string;
  messages: UserMessage[];
  workingIds: Set<string>;
  readingAll: boolean;
  onRead: (message: UserMessage) => Promise<void>;
}) {
  if (messages.length === 0) return null;

  return (
    <section className='space-y-2.5'>
      <h3 className='px-0.5 text-xs font-semibold text-gray-500 dark:text-gray-400'>
        {title}
      </h3>
      {messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          working={readingAll || workingIds.has(message.id)}
          onRead={onRead}
        />
      ))}
    </section>
  );
}

export default function MessagePanel({
  open,
  page,
  loading,
  loadingMore,
  loadError,
  workingIds,
  onClose,
  onRead,
  onReadAll,
  onLoadMore,
  onRetry,
}: MessagePanelProps) {
  const titleId = useId();
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;
  const readingAll = workingIds.has('all');
  const announcements = page.items.filter(
    (message) => message.type === 'announcement',
  );
  const trackingUpdates = page.items.filter(
    (message) => message.type === 'tracking-update',
  );

  return createPortal(
    <div className='fixed inset-0 z-[1250] flex items-center justify-center p-4 sm:p-6'>
      <button
        type='button'
        aria-label='关闭消息面板'
        className='absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm'
        onClick={onClose}
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        className='relative z-10 flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/90 shadow-2xl outline-none ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/90 dark:ring-white/10'
      >
        <div className='flex shrink-0 items-center gap-3 border-b border-gray-200/80 px-4 py-3.5 dark:border-gray-700/80 sm:px-6 sm:py-4'>
          <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'>
            <Inbox className='h-5 w-5' />
          </div>
          <div className='min-w-0 flex-1'>
            <h2
              id={titleId}
              className='text-base font-semibold text-gray-900 dark:text-gray-100'
            >
              我的消息
            </h2>
            <p className='mt-0.5 text-xs text-gray-400 dark:text-gray-500'>
              {page.total > 0
                ? `${page.total} 条未读消息`
                : '公告与追更动态会显示在这里'}
            </p>
          </div>
          {page.total > 0 && (
            <button
              type='button'
              disabled={readingAll}
              className='inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-300'
              onClick={() => void onReadAll()}
            >
              {readingAll && (
                <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
              )}
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

        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5'>
          {loading && page.items.length === 0 ? (
            <div className='flex min-h-52 items-center justify-center text-gray-400'>
              <LoaderCircle className='h-6 w-6 animate-spin' />
            </div>
          ) : loadError && page.items.length === 0 ? (
            <div className='flex min-h-52 flex-col items-center justify-center gap-3 px-4 text-center'>
              <div className='flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'>
                <RefreshCw className='h-5 w-5' />
              </div>
              <div>
                <p className='text-sm font-medium text-gray-700 dark:text-gray-200'>
                  消息加载失败
                </p>
                <p className='mt-1 text-xs text-gray-400 dark:text-gray-500'>
                  {loadError}
                </p>
              </div>
              <button
                type='button'
                className='rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700'
                onClick={() => void onRetry()}
              >
                重新加载
              </button>
            </div>
          ) : page.items.length === 0 ? (
            <div className='flex min-h-52 flex-col items-center justify-center gap-2 px-4 text-center text-gray-400'>
              <Inbox className='h-10 w-10' />
              <p className='text-sm'>暂无新消息</p>
            </div>
          ) : (
            <div className='space-y-5'>
              <MessageSection
                title='公告'
                messages={announcements}
                workingIds={workingIds}
                readingAll={readingAll}
                onRead={onRead}
              />
              <MessageSection
                title='追更更新'
                messages={trackingUpdates}
                workingIds={workingIds}
                readingAll={readingAll}
                onRead={onRead}
              />
              {page.nextCursor && (
                <div className='flex justify-center pt-1'>
                  <button
                    type='button'
                    disabled={loadingMore}
                    className='inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50'
                    onClick={() => void onLoadMore()}
                  >
                    {loadingMore && (
                      <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
                    )}
                    {loadingMore ? '加载中' : '加载更多'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
