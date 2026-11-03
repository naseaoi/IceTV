'use client';

import { EyeOff, Flag, MoreHorizontal, ThumbsUp, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import ExpandableText from '@/components/ExpandableText';
import ModalShell from '@/components/modals/ModalShell';
import ProfileAvatar from '@/components/ProfileAvatar';
import RatingBadge from '@/components/RatingBadge';
import { formatRelativeTime } from '@/lib/relative-time';
import {
  type PublicVideoReview,
  type ReviewReportReason,
  REVIEW_REPORT_REASONS,
} from '@/lib/types';
import { reportVideoReview, setReviewLiked } from '@/lib/video-reviews.client';

export const REPORT_REASON_LABELS: Record<ReviewReportReason, string> = {
  spoiler: '未标注剧透',
  abuse: '辱骂或人身攻击',
  spam: '广告或垃圾内容',
  illegal: '违法违规内容',
  other: '其他',
};

export function SpoilerContent({
  content,
  spoiler,
}: {
  content: string;
  spoiler?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => setRevealed(false), [content, spoiler]);
  if (!content) return null;
  return spoiler && !revealed ? (
    <button
      type='button'
      onClick={() => setRevealed(true)}
      className='my-2 flex min-h-16 w-full items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-500 dark:bg-white/5 dark:text-gray-400'
    >
      <EyeOff className='h-4 w-4' />
      包含剧透，点击显示
    </button>
  ) : (
    <ExpandableText
      text={content}
      className='text-[13px] leading-[1.7] text-gray-600 dark:text-gray-400'
    />
  );
}

export default function PublicReviewContent({
  review,
  isMine,
  hideAuthor = false,
}: {
  review: PublicVideoReview;
  isMine: boolean;
  // 个人主页内每条评价作者相同，省略头像与昵称
  hideAuthor?: boolean;
}) {
  const [like, setLike] = useState({
    liked: review.likedByMe,
    likeCount: review.likeCount,
  });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReviewReportReason>('spoiler');
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setLike({ liked: review.likedByMe, likeCount: review.likeCount });
  }, [review.likedByMe, review.likeCount]);
  const target = {
    profileId: review.author.profileId,
    title_norm: review.title_norm,
    year: review.year,
  };
  async function toggleLike() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const previous = like;
    setLike({
      liked: !like.liked,
      likeCount: Math.max(0, like.likeCount + (like.liked ? -1 : 1)),
    });
    try {
      setLike(await setReviewLiked(target, !previous.liked));
    } catch (error) {
      setLike(previous);
      setError((error as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function sendReport(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError('');
    try {
      await reportVideoReview(target, reason, detail.trim());
      setReporting(false);
      setMessage('举报已提交');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className='flex gap-3'>
      {!hideAuthor && (
        <Link
          href={`/u/${review.author.profileId}`}
          aria-label={`查看${review.author.nickname ?? '未设置昵称'}的主页`}
        >
          <ProfileAvatar user={review.author} />
        </Link>
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex min-h-7 items-center gap-2'>
          {!hideAuthor && (
            <Link
              href={`/u/${review.author.profileId}`}
              className='min-w-0 truncate text-[13px] font-medium text-gray-900 hover:text-brand-600 dark:text-gray-100'
            >
              {review.author.nickname ?? '未设置昵称'}
            </Link>
          )}
          {isMine && !hideAuthor && (
            <span className='shrink-0 text-xs text-brand-600 dark:text-brand-400'>
              我
            </span>
          )}
          {review.rating !== null && (
            <RatingBadge value={review.rating} className='shrink-0' />
          )}
          <span className='shrink-0 text-[11px] text-gray-400'>
            {formatRelativeTime(review.updated_at)}
          </span>
          <div className='-mr-1.5 ml-auto flex shrink-0 items-center text-xs text-gray-500 dark:text-gray-400'>
            {isMine ? (
              like.likeCount > 0 && (
                <span
                  aria-label={`${like.likeCount} 人点赞`}
                  className='inline-flex h-7 items-center gap-1 px-2'
                >
                  <ThumbsUp aria-hidden='true' className='h-3.5 w-3.5' />
                  <span className='tabular-nums'>{like.likeCount}</span>
                </span>
              )
            ) : (
              <>
                <button
                  type='button'
                  aria-label='点赞评价'
                  aria-pressed={like.liked}
                  disabled={busy}
                  onClick={() => void toggleLike()}
                  className={`inline-flex h-7 items-center gap-1 rounded-full px-2 transition hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-white/10 ${like.liked ? 'text-brand-600 dark:text-brand-400' : 'hover:text-gray-700 dark:hover:text-gray-200'}`}
                >
                  <ThumbsUp
                    aria-hidden='true'
                    className={`h-3.5 w-3.5 ${like.liked ? 'fill-current' : ''}`}
                  />
                  <span className='tabular-nums'>{like.likeCount}</span>
                </button>
                <div className='relative'>
                  <button
                    type='button'
                    aria-label='更多评价操作'
                    aria-expanded={menu}
                    onClick={() => setMenu(!menu)}
                    className='flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200'
                  >
                    <MoreHorizontal aria-hidden='true' className='h-4 w-4' />
                  </button>
                  {menu && (
                    <button
                      type='button'
                      onClick={() => {
                        setMenu(false);
                        setReporting(true);
                        setError('');
                      }}
                      className='absolute right-0 top-full z-10 mt-1 flex items-center gap-2 whitespace-nowrap rounded-lg bg-white px-4 py-2 text-sm text-gray-700 shadow-lg ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-700'
                    >
                      <Flag aria-hidden='true' className='h-3.5 w-3.5' />
                      举报
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className='mt-1.5'>
          <SpoilerContent content={review.content} spoiler={review.spoiler} />
        </div>
        {error && !reporting && (
          <p role='alert' className='text-xs text-red-500'>
            {error}
          </p>
        )}
        {message && (
          <p role='status' className='text-xs text-brand-600'>
            {message}
          </p>
        )}
      </div>
      <ModalShell
        isOpen={reporting}
        onClose={() => {
          if (!sending) setReporting(false);
        }}
        panelClassName='max-w-md p-6'
      >
        <form
          onSubmit={sendReport}
          role='dialog'
          aria-modal='true'
          aria-label='举报评价'
        >
          <div className='mb-4 flex items-center justify-between'>
            <h3 className='font-semibold'>举报评价</h3>
            <button
              type='button'
              aria-label='关闭举报'
              disabled={sending}
              onClick={() => setReporting(false)}
            >
              <X className='h-5 w-5' />
            </button>
          </div>
          <fieldset disabled={sending} className='space-y-3'>
            <legend className='sr-only'>举报原因</legend>
            {REVIEW_REPORT_REASONS.map((value) => (
              <label key={value} className='flex items-center gap-2 text-sm'>
                <input
                  type='radio'
                  name='report-reason'
                  checked={reason === value}
                  onChange={() => setReason(value)}
                  className='border-0 p-0 text-brand-600 ring-1 ring-gray-300 focus:ring-0'
                />
                {REPORT_REASON_LABELS[value]}
              </label>
            ))}
          </fieldset>
          <textarea
            aria-label='举报说明'
            placeholder='补充说明（可选，最多 200 字）'
            value={detail}
            maxLength={200}
            disabled={sending}
            onChange={(event) => setDetail(event.target.value)}
            className='mt-4 min-h-24 w-full rounded-xl border-0 bg-gray-100 p-3 text-sm focus:ring-0 dark:bg-white/10'
          />
          <p className='text-right text-xs text-gray-500'>
            {detail.length}/200
          </p>
          {error && (
            <p role='alert' className='text-sm text-red-500'>
              {error}
            </p>
          )}
          <button
            type='submit'
            disabled={sending}
            className='mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50'
          >
            {sending ? '提交中…' : '提交举报'}
          </button>
        </form>
      </ModalShell>
    </div>
  );
}
