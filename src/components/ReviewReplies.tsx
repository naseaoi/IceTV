'use client';

import { ChevronDown, Flag, Reply, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import MoreMenu, { type MoreMenuItem } from '@/components/MoreMenu';
import ProfileAvatar from '@/components/ProfileAvatar';
import ReportDialog from '@/components/ReportDialog';
import UserRoleBadge from '@/components/UserRoleBadge';
import { formatRelativeTime } from '@/lib/relative-time';
import type { PublicReviewReply } from '@/lib/types';
import {
  type ReviewTarget,
  deleteReviewReply,
  fetchReviewReplies,
  postReviewReply,
  reportReviewReply,
  REVIEW_REPLY_MAX_LENGTH,
} from '@/lib/video-reviews.client';

interface ReplyTarget {
  id: string | null;
  nickname: string | null;
}

const REPLY_MENU_TRIGGER_CLASS =
  'flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-700 aria-expanded:bg-gray-200/70 aria-expanded:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200 dark:aria-expanded:bg-white/10 dark:aria-expanded:text-gray-200';

function displayName(nickname: string | null) {
  return nickname ?? '未设置昵称';
}

export function useReviewReplies(
  target: ReviewTarget,
  initialCount: number,
  defaultExpanded = false,
) {
  const [count, setCount] = useState(initialCount);
  const [expanded, setExpanded] = useState(defaultExpanded && initialCount > 0);
  const [items, setItems] = useState<PublicReviewReply[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState<ReplyTarget | null>(null);
  const loadingRef = useRef(false);
  const { profileId, title_norm, year } = target;

  useEffect(() => setCount(initialCount), [initialCount]);

  const load = useCallback(
    async (cursor?: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError('');
      try {
        const page = await fetchReviewReplies(
          { profileId, title_norm, year },
          cursor,
        );
        setItems((previous) =>
          cursor && previous ? [...previous, ...page.items] : page.items,
        );
        setNextCursor(page.nextCursor);
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [profileId, title_norm, year],
  );

  const expandedOnMount = useRef(expanded);
  useEffect(() => {
    if (expandedOnMount.current) void load();
  }, [load]);

  const expand = useCallback(() => {
    setExpanded(true);
    if (items === null) void load();
  }, [items, load]);

  return {
    target,
    count,
    expanded,
    items,
    nextCursor,
    loading,
    error,
    composing,
    toggle: () => (expanded ? setExpanded(false) : expand()),
    loadMore: () => nextCursor && void load(nextCursor),
    startReply: (replyTo: ReplyTarget) => {
      setComposing(replyTo);
      if (count > 0) expand();
    },
    cancelReply: () => setComposing(null),
    async submit(content: string) {
      const reply = await postReviewReply(
        target,
        content,
        composing?.id ?? undefined,
      );
      setItems((previous) => [...(previous ?? []), reply]);
      setCount((value) => value + 1);
      setExpanded(true);
      setComposing(null);
    },
    async remove(id: string) {
      await deleteReviewReply(id);
      setItems(
        (previous) => previous?.filter((item) => item.id !== id) ?? null,
      );
      setCount((value) => Math.max(0, value - 1));
    },
  };
}

type ReviewRepliesController = ReturnType<typeof useReviewReplies>;

function ReplyComposer({
  replyTo,
  onCancel,
  onSubmit,
}: {
  replyTo: ReplyTarget;
  onCancel: () => void;
  onSubmit: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = content.trim();

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
    textareaRef.current?.scrollIntoView({ block: 'nearest' });
  }, [replyTo.id]);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!trimmed || sending) return;
    setSending(true);
    setError('');
    try {
      await onSubmit(trimmed);
    } catch (submitError) {
      setError((submitError as Error).message);
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className='mt-2 rounded-xl bg-gray-100 p-2 dark:bg-white/[0.06]'
    >
      <textarea
        ref={textareaRef}
        aria-label='回复内容'
        rows={2}
        value={content}
        maxLength={REVIEW_REPLY_MAX_LENGTH}
        disabled={sending}
        placeholder={`回复 @${displayName(replyTo.nickname)}`}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          } else if (
            event.key === 'Enter' &&
            (event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            void submit();
          }
        }}
        className='block w-full resize-none border-0 bg-transparent p-1 text-[13px] leading-[1.7] text-gray-800 placeholder:text-gray-400 focus:ring-0 dark:text-gray-100 dark:placeholder:text-gray-500'
      />
      {error && (
        <p role='alert' className='px-1 text-xs text-red-500'>
          {error}
        </p>
      )}
      <div className='mt-1 flex items-center justify-end gap-2'>
        <span className='mr-auto px-1 text-[11px] tabular-nums text-gray-400'>
          {content.length}/{REVIEW_REPLY_MAX_LENGTH}
        </span>
        <button
          type='button'
          disabled={sending}
          onClick={onCancel}
          className='h-7 rounded-full px-3 text-xs text-gray-500 transition hover:bg-gray-200/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200'
        >
          取消
        </button>
        <button
          type='submit'
          disabled={!trimmed || sending}
          className='h-7 rounded-full bg-brand-500 px-3.5 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50 disabled:hover:bg-brand-500'
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
    </form>
  );
}

function ReplyItem({
  reply,
  highlighted,
  onReply,
  onReport,
  onDelete,
}: {
  reply: PublicReviewReply;
  highlighted: boolean;
  onReply: () => void;
  onReport: () => void;
  onDelete: () => void;
}) {
  const items: MoreMenuItem[] = reply.isMine
    ? [{ label: '删除', icon: Trash2, danger: true, onSelect: onDelete }]
    : [
        { label: '回复', icon: Reply, onSelect: onReply },
        { label: '举报', icon: Flag, onSelect: onReport },
      ];
  return (
    <li
      className={`flex gap-2 ${highlighted ? '-mx-2 rounded-lg bg-brand-50 px-2 py-1.5 dark:bg-brand-500/10' : ''}`}
    >
      <Link
        href={`/u/${reply.author.profileId}`}
        aria-label={`查看${displayName(reply.author.nickname)}的主页`}
        className='mt-0.5'
      >
        <ProfileAvatar user={reply.author} className='h-6 w-6' />
      </Link>
      <div className='min-w-0 flex-1'>
        <div className='flex min-h-6 items-center gap-1.5 text-xs'>
          <span className='flex min-w-0 items-center gap-1'>
            <Link
              href={`/u/${reply.author.profileId}`}
              className='truncate font-medium text-gray-900 hover:text-brand-600 dark:text-gray-100'
            >
              {displayName(reply.author.nickname)}
            </Link>
            <UserRoleBadge role={reply.author.role} />
            {reply.replyTo && (
              <>
                <span className='shrink-0 text-gray-400'>回复</span>
                <Link
                  href={`/u/${reply.replyTo.profileId}`}
                  className='truncate text-brand-600 hover:underline dark:text-brand-400'
                >
                  @{displayName(reply.replyTo.nickname)}
                </Link>
              </>
            )}
          </span>
          <span className='shrink-0 text-[11px] text-gray-400'>
            {formatRelativeTime(reply.created_at)}
          </span>
          <span className='-mr-1 ml-auto shrink-0'>
            <MoreMenu
              label='更多回复操作'
              items={items}
              triggerClassName={REPLY_MENU_TRIGGER_CLASS}
            />
          </span>
        </div>
        <p className='whitespace-pre-wrap break-words text-[13px] leading-[1.7] text-gray-600 dark:text-gray-400'>
          {reply.content}
        </p>
      </div>
    </li>
  );
}

export default function ReviewReplies({
  controller,
  highlightId,
}: {
  controller: ReviewRepliesController;
  highlightId?: string;
}) {
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const { count, expanded, items, composing } = controller;
  const showList = expanded && count > 0;

  if (count === 0 && !composing) return null;

  async function confirmDelete() {
    if (!deletingId) return;
    setDeleting(true);
    setActionError('');
    try {
      await controller.remove(deletingId);
      setDeletingId(null);
    } catch (deleteError) {
      setActionError((deleteError as Error).message);
      setDeletingId(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className='mt-2'>
      {count > 0 && (
        <button
          type='button'
          aria-expanded={expanded}
          onClick={controller.toggle}
          className='inline-flex h-6 items-center gap-1 text-xs text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
        >
          {expanded ? '收起回复' : `${count} 条回复`}
          <ChevronDown
            aria-hidden='true'
            className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
      {showList && (
        <div className='mt-1.5 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-white/[0.03]'>
          {items && items.length > 0 && (
            <ul className='space-y-2.5'>
              {items.map((reply) => (
                <ReplyItem
                  key={reply.id}
                  reply={reply}
                  highlighted={reply.id === highlightId}
                  onReply={() =>
                    controller.startReply({
                      id: reply.id,
                      nickname: reply.author.nickname,
                    })
                  }
                  onReport={() => setReportingId(reply.id)}
                  onDelete={() => setDeletingId(reply.id)}
                />
              ))}
            </ul>
          )}
          {controller.loading && (
            <p className='py-1 text-xs text-gray-400'>加载中…</p>
          )}
          {controller.error && (
            <p role='alert' className='py-1 text-xs text-red-500'>
              {controller.error}
            </p>
          )}
          {controller.nextCursor && !controller.loading && (
            <button
              type='button'
              onClick={controller.loadMore}
              className='mt-2 text-xs text-brand-600 hover:underline dark:text-brand-400'
            >
              加载更多回复
            </button>
          )}
        </div>
      )}
      {composing && (
        <ReplyComposer
          key={composing.id ?? 'review'}
          replyTo={composing}
          onCancel={controller.cancelReply}
          onSubmit={controller.submit}
        />
      )}
      {actionError && (
        <p role='alert' className='mt-1 text-xs text-red-500'>
          {actionError}
        </p>
      )}
      {notice && (
        <p role='status' className='mt-1 text-xs text-brand-600'>
          {notice}
        </p>
      )}
      <ReportDialog
        isOpen={reportingId !== null}
        title='举报回复'
        onClose={() => setReportingId(null)}
        onSubmit={async (reason, detail) => {
          if (!reportingId) return;
          await reportReviewReply(reportingId, reason, detail);
          setReportingId(null);
          setNotice('举报已提交');
        }}
      />
      <ConfirmModal
        isOpen={deletingId !== null}
        title='删除这条回复？'
        onClose={() => {
          if (!deleting) setDeletingId(null);
        }}
        onConfirm={() => void confirmDelete()}
        confirmDisabled={deleting}
        confirmText={deleting ? '删除中...' : '删除'}
        danger
      />
    </div>
  );
}
