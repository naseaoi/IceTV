'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import ModalShell from '@/components/modals/ModalShell';
import ProfileAvatar from '@/components/ProfileAvatar';
import SkeletonText from '@/components/SkeletonText';
import Spinner from '@/components/Spinner';
import WatchLevelBadge from '@/components/WatchLevelBadge';
import { useProfilePage } from '@/features/profile/hooks/useProfilePage';
import { getUserFollows } from '@/lib/profile.client';
import { FOLLOW_PAGE_SIZE } from '@/lib/user-profile';

const FOLLOW_ROW_CLASS = 'flex items-center gap-3 rounded-xl p-3';
const FOLLOW_AVATAR_CLASS = 'h-8 w-8';
const FOLLOW_EMPTY_CLASS = 'py-8 text-center text-sm';
// 计数未知时的骨架条数
const FOLLOW_SKELETON_FALLBACK = 3;

export const profileButtonClass =
  'rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15';
export function PageFooter({
  loading,
  error,
  cursor,
  loadMore,
}: {
  loading: boolean;
  error: string;
  cursor: string | null;
  loadMore: () => Promise<void>;
}) {
  return (
    <div className='py-6 text-center'>
      {error && (
        <p role='alert' className='mb-3 text-sm text-red-500'>
          {error}
        </p>
      )}
      {loading ? (
        <Spinner label='加载中' className='mx-auto h-5 w-5 text-gray-400' />
      ) : (
        (cursor || error) && (
          <button
            type='button'
            className={profileButtonClass}
            onClick={() => void loadMore()}
          >
            {error ? '重试' : '加载更多'}
          </button>
        )
      )}
    </div>
  );
}
export function FollowList({
  isOpen,
  profileId,
  type,
  count,
  onClose,
}: {
  isOpen: boolean;
  profileId: string;
  type: 'followers' | 'following' | null;
  // 资料里已知的关注 / 粉丝数，决定首屏骨架条数；未知传 null
  count: number | null;
  onClose: () => void;
}) {
  return (
    <ModalShell isOpen={isOpen} onClose={onClose} panelClassName='max-w-md p-5'>
      {type && (
        <FollowListContent
          key={`${profileId}:${type}`}
          profileId={profileId}
          type={type}
          count={count}
          onClose={onClose}
        />
      )}
    </ModalShell>
  );
}

function FollowListSkeleton({ count }: { count: number | null }) {
  if (count === 0)
    return (
      <div aria-hidden='true' className={FOLLOW_EMPTY_CLASS}>
        &nbsp;
      </div>
    );
  const rows = Math.min(count ?? FOLLOW_SKELETON_FALLBACK, FOLLOW_PAGE_SIZE);
  return (
    <div role='status' aria-label='加载中'>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={FOLLOW_ROW_CLASS}>
          <div
            className={`skeleton shrink-0 rounded-full ${FOLLOW_AVATAR_CLASS}`}
          />
          <SkeletonText barClassName='h-4 w-24 rounded' />
        </div>
      ))}
    </div>
  );
}

function FollowListContent({
  profileId,
  type,
  count,
  onClose,
}: {
  profileId: string;
  type: 'followers' | 'following';
  count: number | null;
  onClose: () => void;
}) {
  const load = useCallback(
    (cursor: string | null) => getUserFollows(profileId, type, cursor),
    [profileId, type],
  );
  const page = useProfilePage(load);
  const initialLoading = page.loading && !page.error && page.items.length === 0;
  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-label={type === 'followers' ? '粉丝' : '关注'}
    >
      <div className='mb-4 flex justify-between'>
        <h2 className='font-semibold'>
          {type === 'followers' ? '粉丝' : '关注'}
        </h2>
        <button type='button' aria-label='关闭列表' onClick={onClose}>
          <X className='h-5 w-5' />
        </button>
      </div>
      <div className='max-h-[60dvh] overflow-y-auto'>
        {page.items.map((item) => (
          <Link
            key={item.profileId}
            href={`/u/${item.profileId}`}
            onClick={onClose}
            className={`${FOLLOW_ROW_CLASS} hover:bg-gray-100 dark:hover:bg-white/5`}
          >
            <ProfileAvatar user={item} className={FOLLOW_AVATAR_CLASS} />
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='truncate'>{item.nickname ?? '未设置昵称'}</span>
              <WatchLevelBadge level={item.level} />
            </span>
          </Link>
        ))}
        {initialLoading && <FollowListSkeleton count={count} />}
        {!page.loading && !page.error && page.items.length === 0 && (
          <p className={`${FOLLOW_EMPTY_CLASS} text-gray-500`}>暂无用户</p>
        )}
        <PageFooter {...page} loading={page.loading && !initialLoading} />
      </div>
    </div>
  );
}
