'use client';

import { ChevronRight, PenLine } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import ProfileAvatar from '@/components/ProfileAvatar';
import { ProfilePanel } from '@/components/user-menu/ProfilePanel';
import { FollowList } from '@/features/profile/FollowList';
import { getUserProfile } from '@/lib/profile.client';
import { fetchMyVideoReviews } from '@/lib/video-reviews.client';

interface MineStats {
  reviews: number;
  following: number;
  followers: number;
}

const CARD_CLASS =
  'mb-4 flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-gray-200/80 dark:bg-white/[0.04] dark:ring-white/10 sm:p-5';
const AVATAR_CLASS = 'h-14 w-14 shrink-0 text-xl sm:h-16 sm:w-16 sm:text-2xl';
const STAT_CLASS =
  'inline-flex items-baseline gap-1 text-gray-500 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100';

function StatValue({ value }: { value: number | null | undefined }) {
  if (value === undefined) {
    return (
      <span className='inline-block h-3.5 w-5 animate-pulse self-center rounded bg-gray-200 dark:bg-white/10' />
    );
  }
  return (
    <span className='font-semibold tabular-nums text-gray-900 dark:text-gray-100'>
      {value ?? '–'}
    </span>
  );
}

// 尺寸与 MineProfileHeader 一致，供 /me/loading.tsx 占位
export function MineProfileHeaderSkeleton() {
  return (
    <div aria-hidden='true' className={CARD_CLASS}>
      <div
        className={`${AVATAR_CLASS} animate-pulse rounded-full bg-gray-200 dark:bg-white/10`}
      />
      <div className='min-w-0 flex-1 space-y-2.5'>
        <div className='h-5 w-28 animate-pulse rounded bg-gray-200 dark:bg-white/10' />
        <div className='h-4 w-44 animate-pulse rounded bg-gray-200 dark:bg-white/10' />
      </div>
    </div>
  );
}

export function MineProfileHeader() {
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;
  // undefined 表示加载中，null 表示加载失败
  const [stats, setStats] = useState<MineStats | null | undefined>(undefined);
  const [list, setList] = useState<'followers' | 'following' | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    Promise.all([getUserProfile(profileId), fetchMyVideoReviews()])
      .then(([profile, reviews]) => {
        if (!active) return;
        setStats({
          reviews: reviews.length,
          following: profile.followingCount,
          followers: profile.followerCount,
        });
      })
      .catch(() => {
        if (active) setStats(null);
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  if (session.status !== 'authenticated' || !profileId) {
    return <MineProfileHeaderSkeleton />;
  }

  const nickname = session.nickname ?? '未设置昵称';
  const profileHref = `/u/${profileId}`;
  const value = (key: keyof MineStats) =>
    stats === undefined ? undefined : (stats?.[key] ?? null);

  return (
    <section aria-label='个人资料' className={CARD_CLASS}>
      <Link
        href={profileHref}
        aria-label={`查看${nickname}的主页`}
        className='shrink-0'
      >
        <ProfileAvatar
          profileId={profileId}
          nickname={session.nickname}
          className={AVATAR_CLASS}
        />
      </Link>

      <div className='min-w-0 flex-1'>
        <div className='flex min-w-0 items-center gap-1'>
          <h1 className='truncate text-lg font-semibold leading-7 text-gray-900 dark:text-gray-50 sm:text-xl'>
            {nickname}
          </h1>
          <button
            type='button'
            aria-label='编辑资料'
            title='编辑资料'
            onClick={() => setEditing(true)}
            className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200'
          >
            <PenLine aria-hidden='true' className='h-3.5 w-3.5' />
          </button>
        </div>
        <div className='mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm'>
          <Link href='/me/reviews' className={STAT_CLASS}>
            <StatValue value={value('reviews')} />
            评价
          </Link>
          <button
            type='button'
            onClick={() => setList('following')}
            className={STAT_CLASS}
          >
            <StatValue value={value('following')} />
            关注
          </button>
          <button
            type='button'
            onClick={() => setList('followers')}
            className={STAT_CLASS}
          >
            <StatValue value={value('followers')} />
            粉丝
          </button>
        </div>
      </div>

      <Link
        href={profileHref}
        className='-mr-1 flex shrink-0 items-center gap-0.5 rounded-full py-1.5 pl-3 pr-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100'
      >
        <span className='hidden sm:inline'>个人主页</span>
        <span className='sr-only sm:hidden'>个人主页</span>
        <ChevronRight aria-hidden='true' className='h-4 w-4' />
      </Link>

      {list && (
        <FollowList
          profileId={profileId}
          type={list}
          onClose={() => setList(null)}
        />
      )}
      {editing && <ProfilePanel onClose={() => setEditing(false)} />}
    </section>
  );
}
