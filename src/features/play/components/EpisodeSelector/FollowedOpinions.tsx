'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import ProfileAvatar from '@/components/ProfileAvatar';
import RatingStars from '@/components/RatingStars';
import { WATCH_STATUS_OPTIONS } from '@/components/watch-record-context';
import WatchLevelBadge from '@/components/WatchLevelBadge';
import {
  type FollowedOpinion,
  type FollowedOpinions as Opinions,
  fetchFollowedOpinions,
} from '@/features/play/lib/followed-opinions';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import { formatRating } from '@/lib/rating';

const STATUS_LABELS = new Map(
  WATCH_STATUS_OPTIONS.map((option) => [option.value, option.label]),
);
const STACK_LIMIT = 3;

export function useFollowedOpinions(title: string, year: string) {
  const authenticated = useAuthSession().session.status === 'authenticated';
  const [state, setState] = useState<{
    key: string;
    data: Opinions;
  } | null>(null);
  const key = `${title}\u0000${year}`;

  useEffect(() => {
    if (!authenticated || !title) return;
    let active = true;
    fetchFollowedOpinions(title, year)
      .then((data) => {
        if (active) setState({ key, data });
      })
      // 辅助信息，失败时不展示入口
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authenticated, key, title, year]);

  return authenticated && state?.key === key ? state.data : null;
}

function summaryText(data: Opinions) {
  const rating =
    data.averageRating !== null ? ` · ${formatRating(data.averageRating)}` : '';
  if (data.watchedCount > 0)
    return `关注的 ${data.watchedCount} 人看过${rating}`;
  const action = data.ratedCount === data.items.length ? '评过' : '标记过';
  return `关注的 ${data.items.length} 人${action}${rating}`;
}

export function FollowedOpinionsButton({
  title,
  year,
}: {
  title: string;
  year: string;
}) {
  const data = useFollowedOpinions(title, year);
  const [open, setOpen] = useState(false);
  if (!data || data.items.length === 0) return null;
  const text = summaryText(data);
  return (
    <>
      <button
        type='button'
        title={text}
        onClick={() => setOpen(true)}
        className='inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full py-0 pl-1 pr-3 text-xs text-gray-600 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.07] dark:hover:text-white'
      >
        <span className='flex shrink-0 -space-x-1.5'>
          {data.items.slice(0, STACK_LIMIT).map((item) => (
            <ProfileAvatar
              key={item.author.profileId}
              user={item.author}
              className='h-5 w-5 rounded-full ring-2 ring-white dark:ring-gray-900'
            />
          ))}
        </span>
        {data.averageRating !== null ? (
          <>
            <span className='truncate'>关注的 {data.items.length} 人</span>
            <span className='-ml-1 shrink-0 tabular-nums'>
              ·{' '}
              <span className='font-medium text-amber-600 dark:text-amber-400'>
                {formatRating(data.averageRating)}
              </span>
            </span>
          </>
        ) : (
          <span className='truncate tabular-nums'>{text}</span>
        )}
      </button>
      <FollowedOpinionsModal
        open={open}
        title={title}
        data={data}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function FollowedOpinionsModal({
  open,
  title,
  data,
  onClose,
}: {
  open: boolean;
  title: string;
  data: Opinions;
  onClose: () => void;
}) {
  const retained = useRetainedValue(open ? data : null);
  return (
    <ModalShell isOpen={open} onClose={onClose} panelClassName='max-w-sm'>
      {retained && (
        <div className='flex max-h-[min(560px,80vh)] flex-col'>
          <div className='flex items-start justify-between gap-3 px-5 pb-3 pt-5'>
            <div className='min-w-0'>
              <h2 className={MODAL_TITLE_CLASS}>关注的人</h2>
              <p className='mt-0.5 truncate text-[13px] text-gray-500 dark:text-gray-400'>
                {title}
              </p>
            </div>
            <button
              type='button'
              aria-label='关闭'
              onClick={onClose}
              className={`${MODAL_CLOSE_BUTTON_CLASS} -mr-1.5`}
            >
              <X className='h-5 w-5' />
            </button>
          </div>
          {retained.averageRating !== null && (
            <div className='mx-5 mb-2 flex items-center gap-2.5 rounded-xl bg-gray-900/[0.03] px-3.5 py-3 dark:bg-white/[0.04]'>
              <span className='text-2xl font-semibold tabular-nums leading-none text-amber-600 dark:text-amber-400'>
                {formatRating(retained.averageRating)}
              </span>
              <RatingStars
                value={retained.averageRating}
                size='sm'
                decorative
              />
              <span className='ml-auto text-xs text-gray-500 dark:text-gray-400'>
                {retained.ratedCount} 人评分
              </span>
            </div>
          )}
          <ul className='min-h-0 flex-1 overflow-y-auto px-2 pb-3'>
            {retained.items.map((item) => (
              <OpinionRow key={item.author.profileId} item={item} />
            ))}
          </ul>
        </div>
      )}
    </ModalShell>
  );
}

function OpinionRow({ item }: { item: FollowedOpinion }) {
  const status = item.status ? STATUS_LABELS.get(item.status) : null;
  return (
    <li>
      <Link
        href={`/u/${encodeURIComponent(item.author.profileId)}`}
        className='flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.05]'
      >
        <ProfileAvatar user={item.author} className='h-9 w-9 rounded-full' />
        <div className='min-w-0 flex-1'>
          <p className='flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100'>
            <span className='truncate'>
              {item.author.nickname ?? '未设置昵称'}
            </span>
            <WatchLevelBadge level={item.author.level} />
          </p>
          <p className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
            {[status, item.hasPublicReview ? '写了评价' : null]
              .filter(Boolean)
              .join(' · ') || '评价过'}
          </p>
        </div>
        {item.rating !== null && (
          <span className='flex shrink-0 items-center gap-1.5'>
            <RatingStars value={item.rating} size='sm' decorative />
            <span className='text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400'>
              {formatRating(item.rating)}
            </span>
          </span>
        )}
      </Link>
    </li>
  );
}
