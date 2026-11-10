'use client';

import {
  Check,
  CheckCheck,
  ChevronLeft,
  Film,
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
import MessageAnnouncements from '@/components/messages/MessageAnnouncements';
import MessageReviewDetail, {
  type ReviewMessage,
  isReviewMessage,
} from '@/components/messages/MessageReviewDetail';
import MessageSettings from '@/components/messages/MessageSettings';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
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
  | { kind: 'announcements' }
  | { kind: 'review'; message: ReviewMessage };

const MESSAGE_PRIMARY_CLASS =
  'truncate text-sm font-semibold text-gray-900 dark:text-gray-100';
const MESSAGE_BODY_CLASS = 'text-sm leading-5 text-gray-600 dark:text-gray-300';
const MESSAGE_META_CLASS = 'mt-1 text-xs text-gray-400 dark:text-gray-500';
// 头像、公告图标与封面共用同一列宽，各类消息的正文左缘对齐
const MESSAGE_LEAD_CLASS = 'h-10 w-10 shrink-0';

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
      className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-brand-100/80 hover:text-brand-700 disabled:opacity-50 dark:hover:bg-brand-900/50 dark:hover:text-brand-300'
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

function SocialLine({ name, action }: { name: string; action: string }) {
  return (
    <p className={`${MESSAGE_BODY_CLASS} break-words`}>
      <span className='font-semibold text-gray-900 dark:text-gray-100'>
        {name}
      </span>
      <span className='ml-1.5'>{action}</span>
    </p>
  );
}

function MessageBody({ message }: { message: UserMessage }) {
  if (message.type === 'announcement' || message.type === 'annual-report')
    return (
      <>
        <div
          className={`${MESSAGE_LEAD_CLASS} flex items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300`}
        >
          {message.type === 'annual-report' ? (
            <Film className='h-[18px] w-[18px]' />
          ) : (
            <Megaphone className='h-[18px] w-[18px]' />
          )}
        </div>
        <div className='min-w-0 flex-1 pt-0.5'>
          <p className='whitespace-pre-line break-words text-sm leading-5 text-gray-800 dark:text-gray-100'>
            {message.type === 'annual-report'
              ? `你的 ${message.year} 年度观影报告已生成`
              : message.content}
          </p>
          <p className={MESSAGE_META_CLASS}>
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
        <ProfileAvatar user={user} className={MESSAGE_LEAD_CLASS} />
        <div className='min-w-0 flex-1 pt-0.5'>
          <SocialLine
            name={user.nickname ?? '未设置昵称'}
            action={
              message.type === 'new-follower'
                ? '关注了你'
                : `${message.likeCount > 1 ? `等 ${message.likeCount} 人` : ''}赞了你对《${message.title}》的评价`
            }
          />
          <p className={MESSAGE_META_CLASS}>
            {formatRelativeTime(message.createdAt)}
          </p>
        </div>
      </>
    );
  }

  if (message.type === 'follow-review' || message.type === 'review-reply')
    return (
      <>
        <ProfileAvatar user={message.author} className={MESSAGE_LEAD_CLASS} />
        <div className='min-w-0 flex-1 pt-0.5'>
          <SocialLine
            name={message.author.nickname ?? '未设置昵称'}
            action={
              message.type === 'review-reply'
                ? `在《${message.title}》中回复了你`
                : `评价了《${message.title}》`
            }
          />
          {message.type === 'review-reply' && (
            <p className='mt-1.5 line-clamp-2 break-words rounded-lg bg-gray-100 px-2.5 py-1.5 text-[13px] leading-5 text-gray-700 dark:bg-white/[0.06] dark:text-gray-300'>
              {message.content}
            </p>
          )}
          <div className='mt-1 flex items-center gap-2'>
            {message.type === 'follow-review' && message.rating !== null && (
              <RatingBadge value={message.rating} />
            )}
            <span className='text-xs text-gray-400 dark:text-gray-500'>
              {formatRelativeTime(message.createdAt)}
            </span>
          </div>
        </div>
      </>
    );

  return (
    <>
      <div className='relative h-[60px] w-10 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800'>
        <CoverImage
          src={message.cover}
          alt={message.title}
          fallbackLabel='无封面'
          checkClientCacheBeforeLoad
        />
      </div>
      <div className='min-w-0 flex-1 pt-0.5'>
        <p className='flex items-center gap-1.5'>
          <Rss className='h-3.5 w-3.5 shrink-0 text-amber-500' />
          <span className={MESSAGE_PRIMARY_CLASS}>{message.title}</span>
        </p>
        <p className={`mt-0.5 ${MESSAGE_BODY_CLASS}`}>
          已从 {message.fromEpisodes} 集更新至 {message.toEpisodes} 集
        </p>
        <p className={MESSAGE_META_CLASS}>
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
  const clickable = isReviewMessage(message) || message.type === 'new-follower';

  return (
    <div
      data-list-motion-key={String(message.id)}
      className={`-mx-2 mb-1 flex items-start gap-2 rounded-xl px-2 py-3 sm:-mx-3 sm:px-3 ${
        message.type === 'announcement' || message.type === 'annual-report'
          ? 'bg-brand-50 dark:bg-brand-950/30'
          : clickable
            ? 'transition-colors hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'
            : ''
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
      ) : message.type === 'annual-report' ? (
        <Link
          href={`/recap/${message.year}`}
          onClick={() => {
            void onRead(message);
            onNavigate();
          }}
          className={bodyClass}
        >
          <MessageBody message={message} />
        </Link>
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

const ANNOUNCEMENT_TITLE_KEY = 'section:announcement';
const FEED_TITLE_KEY = 'section:feed';
const EMPTY_KEY = 'empty';
const LOAD_MORE_KEY = 'load-more';

function SectionTitle({
  motionKey,
  children,
}: {
  motionKey: string;
  children: string;
}) {
  return (
    <h3
      data-list-motion-key={motionKey}
      className='mt-4 pb-1 text-xs font-semibold text-gray-500 first:mt-0 dark:text-gray-400'
    >
      {children}
    </h3>
  );
}

// 分组标题、消息行、空状态与加载更多同在一个动效容器里：
// 已读某组最后一条时标题随之淡出，下一组整体滑上来；读完最后一条时空状态浮现
function MessageList({
  items,
  hasMore,
  loadingMore,
  workingIds,
  onRead,
  onLoadMore,
  onNavigate,
  onOpenReview,
}: {
  items: UserMessage[];
  hasMore: boolean;
  loadingMore: boolean;
  workingIds: Set<string>;
  onRead: (message: UserMessage) => Promise<void>;
  onLoadMore: () => Promise<void>;
  onNavigate: () => void;
  onOpenReview: (message: ReviewMessage) => void;
}) {
  const readingAll = workingIds.has('all');
  const announcements = items.filter(
    (message) =>
      message.type === 'announcement' || message.type === 'annual-report',
  );
  const feed = items.filter(
    (message) =>
      message.type !== 'announcement' && message.type !== 'annual-report',
  );
  const motionKeys = [
    ...(announcements.length > 0 ? [ANNOUNCEMENT_TITLE_KEY] : []),
    ...announcements.map((message) => message.id),
    ...(feed.length > 0 ? [FEED_TITLE_KEY] : []),
    ...feed.map((message) => message.id),
    ...(items.length === 0 ? [EMPTY_KEY] : []),
    ...(hasMore ? [LOAD_MORE_KEY] : []),
  ];
  const containerRef = useListLayoutMotion<HTMLDivElement>(motionKeys);

  const renderRow = (message: UserMessage) => (
    <MessageRow
      key={message.id}
      message={message}
      working={readingAll || workingIds.has(message.id)}
      onRead={onRead}
      onNavigate={onNavigate}
      onOpenReview={onOpenReview}
    />
  );

  return (
    <div ref={containerRef} className='relative flex min-h-full flex-col'>
      {announcements.length > 0 && (
        <SectionTitle motionKey={ANNOUNCEMENT_TITLE_KEY}>
          {announcements.some((message) => message.type === 'annual-report')
            ? '系统消息'
            : '公告'}
        </SectionTitle>
      )}
      {announcements.map(renderRow)}
      {feed.length > 0 && (
        <SectionTitle motionKey={FEED_TITLE_KEY}>
          {feed.some((message) => message.type !== 'tracking-update')
            ? '追更与互动'
            : '追更更新'}
        </SectionTitle>
      )}
      {feed.map(renderRow)}
      {items.length === 0 && (
        <div
          data-list-motion-key={EMPTY_KEY}
          className='flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-gray-400'
        >
          <Inbox className='h-10 w-10' />
          <p className='text-sm'>暂无新消息</p>
        </div>
      )}
      {hasMore && (
        <div
          data-list-motion-key={LOAD_MORE_KEY}
          className='flex justify-center pt-2'
        >
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
        className='motion-dialog relative z-10 flex h-[min(40rem,calc(100dvh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/10 outline-none ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/50 dark:ring-white/[0.08] sm:h-[min(40rem,calc(100dvh-3rem))]'
      >
        <div
          className={`flex shrink-0 items-center gap-1 border-b border-gray-200/70 py-3 pr-3 dark:border-white/[0.06] ${
            view.kind === 'list' ? 'pl-5' : 'pl-3'
          }`}
        >
          {view.kind !== 'list' && (
            <button
              type='button'
              aria-label='返回消息列表'
              title='返回'
              className={MODAL_CLOSE_BUTTON_CLASS}
              onClick={() => setView({ kind: 'list' })}
            >
              <ChevronLeft className='h-4 w-4' />
            </button>
          )}
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <h2 id={titleId} className={`${MODAL_TITLE_CLASS} truncate`}>
              {view.kind === 'settings'
                ? '通知设置'
                : view.kind === 'announcements'
                  ? '公告'
                  : view.kind === 'review'
                    ? '评价详情'
                    : '我的消息'}
            </h2>
            {view.kind === 'list' && page.total > 0 && (
              <span className='inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 px-1.5 text-xs font-medium tabular-nums text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'>
                {page.total > 99 ? '99+' : page.total}
                <span className='sr-only'> 条未读消息</span>
              </span>
            )}
          </div>
          {view.kind === 'list' && page.total > 0 && (
            <button
              type='button'
              disabled={readingAll}
              className='inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
              onClick={() => void onReadAll()}
            >
              {readingAll ? (
                <Spinner className='h-3.5 w-3.5' />
              ) : (
                <CheckCheck className='h-3.5 w-3.5' />
              )}
              全部已读
            </button>
          )}
          {view.kind === 'list' && (
            <button
              type='button'
              aria-label='查看公告'
              title='公告'
              className={MODAL_CLOSE_BUTTON_CLASS}
              onClick={() => showView({ kind: 'announcements' })}
            >
              <Megaphone className='h-4 w-4' />
            </button>
          )}
          {view.kind === 'list' && (
            <button
              type='button'
              aria-label='通知设置'
              title='通知设置'
              className={MODAL_CLOSE_BUTTON_CLASS}
              onClick={() => showView({ kind: 'settings' })}
            >
              <Settings className='h-4 w-4' />
            </button>
          )}
          <button
            type='button'
            aria-label='关闭'
            title='关闭'
            className={MODAL_CLOSE_BUTTON_CLASS}
            onClick={onClose}
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div
          ref={scrollRef}
          className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4'
        >
          {view.kind === 'settings' ? (
            <MessageSettings onSaved={onSettingsSaved} />
          ) : view.kind === 'announcements' ? (
            <MessageAnnouncements />
          ) : view.kind === 'review' ? (
            <MessageReviewDetail
              key={view.message.id}
              message={view.message}
              onNavigate={onClose}
            />
          ) : loading && page.items.length === 0 ? (
            <div className='flex min-h-full items-center justify-center text-gray-400'>
              <Spinner className='h-6 w-6' />
            </div>
          ) : loadError && page.items.length === 0 ? (
            <div className='flex min-h-full flex-col items-center justify-center gap-3 px-4 text-center'>
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
          ) : (
            <MessageList
              items={page.items}
              hasMore={Boolean(page.nextCursor)}
              loadingMore={loadingMore}
              workingIds={workingIds}
              onRead={onRead}
              onLoadMore={onLoadMore}
              onNavigate={onClose}
              onOpenReview={openReview}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
