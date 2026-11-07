'use client';

import {
  Check,
  ChevronLeft,
  Inbox,
  Megaphone,
  Play,
  RefreshCw,
  Rss,
  Settings,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { buildContinuePlayUrl } from '@/components/continue-card/play-url';
import CoverImage from '@/components/CoverImage';
import MessageReviewDetail, {
  type ReviewMessage,
  isReviewMessage,
} from '@/components/messages/MessageReviewDetail';
import MessageSettings from '@/components/messages/MessageSettings';
import { hasOpenModalShell } from '@/components/modals/ModalShell';
import ProfileAvatar from '@/components/ProfileAvatar';
import RatingBadge from '@/components/RatingBadge';
import Spinner from '@/components/Spinner';
import { useBodyScrollLock } from '@/components/user-menu/useBodyScrollLock';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import { usePresence } from '@/hooks/usePresence';
import { UserMessage, UserMessagePage } from '@/lib/message-types';
import { formatRelativeTime } from '@/lib/relative-time';

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
  onSettingsSaved: () => void;
}

type PanelView =
  | { kind: 'list' }
  | { kind: 'settings' }
  | { kind: 'review'; message: ReviewMessage };

const MESSAGE_PRIMARY_CLASS =
  'truncate text-sm font-semibold text-gray-900 dark:text-gray-100';
const MESSAGE_BODY_CLASS =
  'mt-1 text-sm leading-5 text-gray-600 dark:text-gray-300';
const MESSAGE_META_CLASS = 'text-xs text-gray-400 dark:text-gray-500';

function ReadButton({
  working,
  onClick,
}: {
  working: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      disabled={working}
      aria-label='标记为已读'
      title='标记为已读'
      className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-brand-100/80 hover:text-brand-700 disabled:opacity-50 dark:hover:bg-brand-900/50 dark:hover:text-brand-300'
      onClick={onClick}
    >
      {working ? (
        <Spinner className='h-4 w-4' />
      ) : (
        <Check className='h-4 w-4' />
      )}
    </button>
  );
}

function MessageBody({ message }: { message: UserMessage }) {
  if (message.type === 'announcement')
    return (
      <>
        <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/35 dark:text-brand-300'>
          <Megaphone className='h-5 w-5' />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-sm leading-6 text-gray-800 dark:text-gray-100'>
            {message.content}
          </p>
          <p className={`mt-1 ${MESSAGE_META_CLASS}`}>
            {formatRelativeTime(message.createdAt)}
          </p>
        </div>
      </>
    );

  if (message.type === 'new-follower' || message.type === 'review-like') {
    const user =
      message.type === 'new-follower' ? message.follower : message.latestLiker;
    return (
      <>
        <ProfileAvatar user={user} />
        <div className='min-w-0 flex-1'>
          <p className={MESSAGE_PRIMARY_CLASS}>
            {user.nickname ?? '未设置昵称'}
          </p>
          <p className={MESSAGE_BODY_CLASS}>
            {message.type === 'new-follower'
              ? '关注了你'
              : `${message.likeCount > 1 ? `等 ${message.likeCount} 人` : ''}赞了你对《${message.title}》的评价`}
          </p>
          <p className={`mt-1.5 ${MESSAGE_META_CLASS}`}>
            {formatRelativeTime(message.createdAt)}
          </p>
        </div>
      </>
    );
  }

  if (message.type === 'follow-review' || message.type === 'review-reply')
    return (
      <>
        <ProfileAvatar user={message.author} />
        <div className='min-w-0 flex-1'>
          <p className={MESSAGE_PRIMARY_CLASS}>
            {message.author.nickname ?? '未设置昵称'}
          </p>
          <p className={MESSAGE_BODY_CLASS}>
            {message.type === 'review-reply'
              ? `在《${message.title}》中回复了你`
              : `评价了《${message.title}》`}
          </p>
          {message.type === 'review-reply' && (
            <p className={`${MESSAGE_BODY_CLASS} line-clamp-2 break-words`}>
              {message.content}
            </p>
          )}
          <div className='mt-1.5 flex items-center gap-2'>
            {message.type === 'follow-review' && message.rating !== null && (
              <RatingBadge value={message.rating} />
            )}
            <span className={MESSAGE_META_CLASS}>
              {formatRelativeTime(message.createdAt)}
            </span>
          </div>
        </div>
      </>
    );

  return (
    <>
      <div className='relative h-[72px] w-12 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800'>
        <CoverImage
          src={message.cover}
          alt={message.title}
          fallbackLabel='无封面'
          checkClientCacheBeforeLoad
        />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='flex items-center gap-1.5'>
          <Rss className='h-3.5 w-3.5 shrink-0 text-amber-500' />
          <span className={MESSAGE_PRIMARY_CLASS}>{message.title}</span>
        </p>
        <p className={MESSAGE_BODY_CLASS}>
          已从 {message.fromEpisodes} 集更新至 {message.toEpisodes} 集
        </p>
        <p className={`mt-1 ${MESSAGE_META_CLASS}`}>
          {message.sourceName} · {formatRelativeTime(message.createdAt)}
        </p>
      </div>
    </>
  );
}

function MessageRow({
  message,
  working,
  onRead,
  onNavigate,
  onOpenReview,
}: {
  message: UserMessage;
  working: boolean;
  onRead: (message: UserMessage) => Promise<void>;
  onNavigate: () => void;
  onOpenReview: (message: ReviewMessage) => void;
}) {
  const bodyClass = 'flex min-w-0 flex-1 gap-3 text-left';

  return (
    <div
      data-list-motion-key={String(message.id)}
      className={`flex items-start gap-3 rounded-lg border p-3 sm:p-4 ${
        message.type === 'announcement'
          ? 'border-brand-200/80 bg-brand-50/70 dark:border-brand-800/60 dark:bg-brand-950/25'
          : 'border-gray-200/80 bg-white/60 dark:border-gray-700/80 dark:bg-gray-800/40'
      }`}
    >
      {isReviewMessage(message) ? (
        <button
          type='button'
          onClick={() => onOpenReview(message)}
          className={bodyClass}
        >
          <MessageBody message={message} />
        </button>
      ) : message.type === 'new-follower' ? (
        <Link
          href={`/u/${message.follower.profileId}`}
          onClick={onNavigate}
          className={bodyClass}
        >
          <MessageBody message={message} />
        </Link>
      ) : (
        <div className={bodyClass}>
          <MessageBody message={message} />
        </div>
      )}

      <div className='flex shrink-0 flex-col items-end justify-between gap-2 self-stretch'>
        <ReadButton working={working} onClick={() => void onRead(message)} />
        {message.type === 'tracking-update' && (
          <Link
            href={buildContinuePlayUrl({
              source: message.source,
              id: message.videoId,
              title: message.title,
              year: message.year,
              query: message.searchTitle,
            })}
            onClick={onNavigate}
            aria-label={`去观看《${message.title}》`}
            className='inline-flex h-7 items-center gap-1 rounded-full bg-brand-50 px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50'
          >
            <Play className='h-3 w-3 fill-current' />
            去观看
          </Link>
        )}
      </div>
    </div>
  );
}

function MessageSection({
  title,
  messages,
  workingIds,
  readingAll,
  onRead,
  onNavigate,
  onOpenReview,
}: {
  title: string;
  messages: UserMessage[];
  workingIds: Set<string>;
  readingAll: boolean;
  onRead: (message: UserMessage) => Promise<void>;
  onNavigate: () => void;
  onOpenReview: (message: ReviewMessage) => void;
}) {
  const containerRef = useListLayoutMotion<HTMLDivElement>(
    messages.map((message) => String(message.id)),
  );
  if (messages.length === 0) return null;

  return (
    <section className='space-y-2.5'>
      <h3 className='px-0.5 text-xs font-semibold text-gray-500 dark:text-gray-400'>
        {title}
      </h3>
      <div ref={containerRef} className='relative space-y-2.5'>
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            working={readingAll || workingIds.has(message.id)}
            onRead={onRead}
            onNavigate={onNavigate}
            onOpenReview={onOpenReview}
          />
        ))}
      </div>
    </section>
  );
}

const PANEL_EXIT_MS = 130;

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
  onSettingsSaved,
}: MessagePanelProps) {
  const titleId = useId();
  const presence = usePresence(open, PANEL_EXIT_MS);
  useBodyScrollLock(open);
  const [view, setView] = useState<PanelView>({ kind: 'list' });
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setView({ kind: 'list' });
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const listScrollTop = useRef(0);

  // 子视图从顶部开始，回到列表时恢复离开前的位置
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = view.kind === 'list' ? listScrollTop.current : 0;
  }, [view]);

  function showView(next: PanelView) {
    if (view.kind === 'list')
      listScrollTop.current = scrollRef.current?.scrollTop ?? 0;
    setView(next);
  }

  function openReview(message: ReviewMessage) {
    showView({ kind: 'review', message });
    void onRead(message);
  }

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // 叠在面板上的举报、删除确认等弹窗由自己处理 Esc
      if (event.key !== 'Escape' || hasOpenModalShell()) return;
      if (view.kind === 'list') onClose();
      else setView({ kind: 'list' });
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, view.kind]);

  if (!presence.mounted || typeof document === 'undefined') return null;
  const readingAll = workingIds.has('all');
  const announcements = page.items.filter(
    (message) => message.type === 'announcement',
  );
  const trackingUpdates = page.items.filter(
    (message) => message.type !== 'announcement',
  );

  return createPortal(
    <div className='fixed inset-0 z-[1250] flex items-center justify-center p-4 sm:p-6'>
      <button
        type='button'
        aria-label='关闭消息面板'
        data-open={presence.visible}
        className='motion-backdrop absolute inset-0 cursor-default bg-black/50'
        onClick={onClose}
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        data-open={presence.visible}
        className='motion-dialog relative z-10 flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/10 outline-none ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/50 dark:ring-white/[0.08]'
      >
        <div className='flex shrink-0 items-center gap-3 border-b border-gray-200/80 px-4 py-3.5 dark:border-gray-700/80 sm:px-6 sm:py-4'>
          {view.kind === 'list' ? (
            <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'>
              <Inbox className='h-5 w-5' />
            </div>
          ) : (
            <button
              type='button'
              aria-label='返回消息列表'
              title='返回'
              className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
              onClick={() => setView({ kind: 'list' })}
            >
              <ChevronLeft className='h-5 w-5' />
            </button>
          )}
          <div className='min-w-0 flex-1'>
            <h2
              id={titleId}
              className='text-base font-semibold text-gray-900 dark:text-gray-100'
            >
              {view.kind === 'settings'
                ? '通知设置'
                : view.kind === 'review'
                  ? '评价详情'
                  : '我的消息'}
            </h2>
            {view.kind === 'list' && page.total > 0 && (
              <p className='mt-0.5 text-xs text-gray-400 dark:text-gray-500'>
                {page.total} 条未读消息
              </p>
            )}
          </div>
          {view.kind === 'list' && page.total > 0 && (
            <button
              type='button'
              disabled={readingAll}
              className='inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-950/50 dark:hover:text-brand-300'
              onClick={() => void onReadAll()}
            >
              {readingAll && <Spinner className='h-3.5 w-3.5' />}
              全部已读
            </button>
          )}
          {view.kind === 'list' && (
            <button
              type='button'
              aria-label='通知设置'
              title='通知设置'
              className='flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'
              onClick={() => showView({ kind: 'settings' })}
            >
              <Settings className='h-[18px] w-[18px]' />
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

        <div
          ref={scrollRef}
          className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5'
        >
          {view.kind === 'settings' ? (
            <MessageSettings onSaved={onSettingsSaved} />
          ) : view.kind === 'review' ? (
            <MessageReviewDetail
              key={view.message.id}
              message={view.message}
              onNavigate={onClose}
            />
          ) : loading && page.items.length === 0 ? (
            <div className='flex min-h-52 items-center justify-center text-gray-400'>
              <Spinner className='h-6 w-6' />
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
                className='rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700'
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
                onNavigate={onClose}
                onOpenReview={openReview}
              />
              <MessageSection
                title={
                  trackingUpdates.some(
                    (message) => message.type !== 'tracking-update',
                  )
                    ? '追更与互动'
                    : '追更更新'
                }
                messages={trackingUpdates}
                workingIds={workingIds}
                readingAll={readingAll}
                onRead={onRead}
                onNavigate={onClose}
                onOpenReview={openReview}
              />
              {page.nextCursor && (
                <div className='flex justify-center pt-1'>
                  <button
                    type='button'
                    disabled={loadingMore}
                    className='inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-950/50'
                    onClick={() => void onLoadMore()}
                  >
                    {loadingMore && <Spinner className='h-3.5 w-3.5' />}
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
