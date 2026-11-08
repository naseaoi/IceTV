'use client';

import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import PublicReviewContent from '@/components/PublicReviewContent';
import Spinner from '@/components/Spinner';
import type {
  FollowReviewUserMessage,
  ReviewLikeUserMessage,
  ReviewReplyUserMessage,
} from '@/lib/message-types';
import type { PublicVideoReview } from '@/lib/types';
import { fetchPublicReview } from '@/lib/video-reviews.client';

export type ReviewMessage =
  | FollowReviewUserMessage
  | ReviewReplyUserMessage
  | ReviewLikeUserMessage;

export function isReviewMessage(message: {
  type: string;
}): message is ReviewMessage {
  return (
    message.type === 'follow-review' ||
    message.type === 'review-reply' ||
    message.type === 'review-like'
  );
}

type DetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; review: PublicVideoReview | null };

export default function MessageReviewDetail({
  message,
  onNavigate,
}: {
  message: ReviewMessage;
  onNavigate: () => void;
}) {
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { profileId: authorId, title_norm, year } = message.review;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchPublicReview({ profileId: authorId, title_norm, year })
      .then((review) => {
        if (!cancelled) setState({ status: 'ready', review });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [authorId, title_norm, year, attempt]);

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-3'>
        <p className='min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
          {message.title}
        </p>
        <Link
          href={`/play?${new URLSearchParams({ title: message.title, year: message.year, tab: 'reviews' })}`}
          onClick={onNavigate}
          className='inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-brand-50 px-3 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50'
        >
          <MessageSquare className='h-3.5 w-3.5' />
          在播放页查看
        </Link>
      </div>

      {state.status === 'loading' ? (
        <div className='flex min-h-32 items-center justify-center text-gray-400'>
          <Spinner className='h-6 w-6' />
        </div>
      ) : state.status === 'error' ? (
        <div className='flex min-h-32 flex-col items-center justify-center gap-2'>
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            评价加载失败
          </p>
          <button
            type='button'
            onClick={() => setAttempt((value) => value + 1)}
            className='text-sm font-medium text-brand-600 hover:underline dark:text-brand-400'
          >
            重新加载
          </button>
        </div>
      ) : state.review ? (
        <PublicReviewContent
          review={state.review}
          isMine={state.review.author.profileId === profileId}
          defaultRepliesExpanded={message.type === 'review-reply'}
          highlightReplyId={
            message.type === 'review-reply' ? message.replyId : undefined
          }
        />
      ) : (
        <p className='flex min-h-32 items-center justify-center text-sm text-gray-500 dark:text-gray-400'>
          这条评价已删除或设为仅自己可见
        </p>
      )}
    </div>
  );
}
