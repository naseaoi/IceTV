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

const BANNER_CLASS = 'flex items-center gap-4 pb-6 pt-5 sm:gap-5 md:pt-10';
const AVATAR_CLASS = 'h-16 w-16 shrink-0 text-2xl sm:h-20 sm:w-20 sm:text-3xl';
const STAT_CLASS =
  'inline-flex items-baseline gap-1 text-gray-500 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100';
const ACTION_CLASS =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-gray-900/[0.05] px-4 text-sm text-gray-700 transition hover:bg-gray-900/[0.09] dark:bg-white/[0.07] dark:text-gray-200 dark:hover:bg-white/[0.12]';

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

export function MineProfileHeaderSkeleton() {
  return (
    <div aria-hidden='true' className={BANNER_CLASS}>
      <div
        className={`${AVATAR_CLASS} animate-pulse rounded-full bg-gray-200 dark:bg-white/10`}
      />
      <div className='min-w-0 flex-1 space-y-2.5'>
        <div className='h-7 w-36 animate-pulse rounded bg-gray-200 dark:bg-white/10' />
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
    <section aria-label='个人资料' className={BANNER_CLASS}>
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
        <h1 className='truncate text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-50 sm:text-2xl'>
          {nickname}
        </h1>
        <div className='mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm'>
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

      <div className='flex shrink-0 items-center gap-2'>
        <button
          type='button'
          aria-label='编辑资料'
          onClick={() => setEditing(true)}
          className={ACTION_CLASS}
        >
          <PenLine aria-hidden='true' className='h-3.5 w-3.5' />
          <span className='hidden sm:inline'>编辑资料</span>
        </button>
        <Link
          href={profileHref}
          className={`${ACTION_CLASS} hidden sm:inline-flex`}
        >
          个人主页
          <ChevronRight aria-hidden='true' className='-mr-1 h-4 w-4' />
        </Link>
      </div>

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
