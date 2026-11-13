'use client';

import { EyeOff, Flag, Reply, ThumbsUp } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import AnimatedCount from '@/components/AnimatedCount';
import ExpandableText from '@/components/ExpandableText';
import MoreMenu, { type MoreMenuItem } from '@/components/MoreMenu';
import ProfileAvatar from '@/components/ProfileAvatar';
import RatingBadge from '@/components/RatingBadge';
import ReportDialog from '@/components/ReportDialog';
import ReviewReplies, { useReviewReplies } from '@/components/ReviewReplies';
import UserRoleBadge from '@/components/UserRoleBadge';
import { formatRelativeTime } from '@/lib/relative-time';
import type { PublicVideoReview } from '@/lib/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';
import { reportVideoReview, setReviewLiked } from '@/lib/video-reviews.client';

export const PUBLIC_REVIEW_META_CLASS = 'flex min-h-7 items-center gap-2';
export const PUBLIC_REVIEW_TIME_TEXT_CLASS = 'text-[11px]';
export const PUBLIC_REVIEW_BODY_SPACING_CLASS = 'mt-1.5';
export const PUBLIC_REVIEW_BODY_TEXT_CLASS = 'text-[13px] leading-[1.7]';

export { REPORT_REASON_LABELS } from '@/components/ReportDialog';

const REVIEW_MENU_TRIGGER_CLASS =
  'flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-gray-100 hover:text-gray-700 aria-expanded:bg-gray-100 aria-expanded:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200 dark:aria-expanded:bg-white/10 dark:aria-expanded:text-gray-200';

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
      className={`${PUBLIC_REVIEW_BODY_TEXT_CLASS} text-gray-600 dark:text-gray-400`}
    />
  );
}

export default function PublicReviewContent({
  review,
  isMine,
  hideAuthor = false,
  defaultRepliesExpanded = false,
  highlightReplyId,
}: {
  review: PublicVideoReview;
  isMine: boolean;
  // 个人主页内每条评价作者相同，省略头像与昵称
  hideAuthor?: boolean;
  defaultRepliesExpanded?: boolean;
  highlightReplyId?: string;
}) {
  const [like, setLike] = useState({
    liked: review.likedByMe,
    likeCount: review.likeCount,
  });
  const [busy, setBusy] = useState(false);
  const [likePop, setLikePop] = useState(0);
  const inFlight = useRef(false);
  const [reporting, setReporting] = useState(false);
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
  const replies = useReviewReplies(
    target,
    review.replyCount,
    defaultRepliesExpanded,
  );
  const startReply = () =>
    replies.startReply({ id: null, nickname: review.author.nickname });
  const menuItems: MoreMenuItem[] = [
    { label: '回复', icon: Reply, onSelect: startReply },
    ...(isMine
      ? []
      : [
          {
            label: '举报',
            icon: Flag,
            onSelect: () => {
              setReporting(true);
              setError('');
            },
          },
        ]),
  ];
  async function toggleLike() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const previous = like;
    if (!previous.liked) setLikePop((count) => count + 1);
    setLike({
      liked: !like.liked,
      likeCount: Math.max(0, like.likeCount + (like.liked ? -1 : 1)),
    });
    try {
      setLike(await setReviewLiked(target, !previous.liked));
    } catch (error) {
      setLike(previous);
      if (!isAbortError(error))
        setError(getErrorMessage(error, '操作失败，请稍后重试'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const nickname = review.author.nickname ?? '未设置昵称';
  const meta = (
    <>
      {review.rating !== null && (
        <RatingBadge
          value={review.rating}
          variant={hideAuthor ? 'soft' : 'compact'}
          className='shrink-0'
        />
      )}
      <span
        className={`shrink-0 ${PUBLIC_REVIEW_TIME_TEXT_CLASS} text-gray-400`}
      >
        {formatRelativeTime(review.updated_at)}
      </span>
    </>
  );
  const actions = (
    <div className='-mr-1.5 flex shrink-0 items-center text-xs text-gray-500 dark:text-gray-400'>
      {isMine ? (
        like.likeCount > 0 && (
          <span
            aria-label={`${like.likeCount} 人点赞`}
            className='inline-flex h-7 items-center gap-1 px-2'
          >
            <ThumbsUp aria-hidden='true' className='h-3.5 w-3.5' />
            <AnimatedCount value={like.likeCount} className='tabular-nums' />
          </span>
        )
      ) : (
        <button
          type='button'
          aria-label='点赞评价'
          aria-pressed={like.liked}
          disabled={busy}
          onClick={() => void toggleLike()}
          className={`inline-flex h-7 items-center gap-1 rounded-full px-2 transition hover:bg-gray-100 dark:hover:bg-white/10 ${like.liked ? 'text-brand-600 dark:text-brand-400' : 'hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          <ThumbsUp
            key={likePop}
            aria-hidden='true'
            className={`h-3.5 w-3.5 ${like.liked ? 'fill-current' : ''} ${like.liked && likePop > 0 ? 'motion-pop' : ''}`}
          />
          <AnimatedCount value={like.likeCount} className='tabular-nums' />
        </button>
      )}
      <MoreMenu
        label='更多评价操作'
        triggerClassName={REVIEW_MENU_TRIGGER_CLASS}
        items={menuItems}
      />
    </div>
  );
  return (
    <div className='flex gap-3'>
      {!hideAuthor && (
        <Link
          href={`/u/${review.author.profileId}`}
          aria-label={`查看${nickname}的主页`}
          className='self-start'
        >
          <ProfileAvatar user={review.author} className='h-9 w-9' />
        </Link>
      )}
      <div className='min-w-0 flex-1'>
        {hideAuthor ? (
          <div className={PUBLIC_REVIEW_META_CLASS}>
            {meta}
            <div className='ml-auto'>{actions}</div>
          </div>
        ) : (
          <div className='flex gap-2'>
            <div className='min-w-0 flex-1'>
              <div className='flex h-5 items-center gap-1.5'>
                <Link
                  href={`/u/${review.author.profileId}`}
                  className='min-w-0 truncate text-[13px] font-medium text-gray-900 hover:text-brand-600 dark:text-gray-100'
                >
                  {nickname}
                </Link>
                <UserRoleBadge role={review.author.role} />
                {isMine && (
                  <span className='shrink-0 text-xs text-brand-600 dark:text-brand-400'>
                    我
                  </span>
                )}
                {review.authorFollowed && !isMine && (
                  <span className='shrink-0 text-xs text-gray-400 dark:text-gray-500'>
                    已关注
                  </span>
                )}
              </div>
              <div className='flex h-4 items-center gap-2'>{meta}</div>
            </div>
            {/* 操作按钮比昵称行高，上移让两者垂直居中对齐 */}
            <div className='-mt-1 self-start'>{actions}</div>
          </div>
        )}
        <div className={PUBLIC_REVIEW_BODY_SPACING_CLASS}>
          <SpoilerContent content={review.content} spoiler={review.spoiler} />
        </div>
        <ReviewReplies controller={replies} highlightId={highlightReplyId} />
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
      <ReportDialog
        isOpen={reporting}
        title='举报评价'
        onClose={() => setReporting(false)}
        onSubmit={async (reason, detail) => {
          await reportVideoReview(target, reason, detail);
          setReporting(false);
          setMessage('举报已提交');
        }}
      />
    </div>
  );
}
