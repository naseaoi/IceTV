'use client';

import { ChevronRight, PenLine } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import ProfileAvatar from '@/components/ProfileAvatar';
import SkeletonText, { SkeletonNumber } from '@/components/SkeletonText';
import { ProfilePanel } from '@/components/user-menu/ProfilePanel';
import WatchLevelBadge from '@/components/WatchLevelBadge';
import { FollowList } from '@/features/profile/FollowList';
import { WatchLevelPanel } from '@/features/watch-level/WatchLevelPanel';
import { rememberMyReviewCount } from '@/lib/my-review-count';
import { getUserProfile } from '@/lib/profile.client';
import { VIDEO_REVIEWS_UPDATED_EVENT } from '@/lib/video-reviews';
import { fetchMyVideoReviewCount } from '@/lib/video-reviews.client';

interface MineStats {
  reviews: number;
  following: number;
  followers: number;
}

const BANNER_CLASS = 'flex items-center gap-4 pb-6 pt-4 sm:gap-5 md:pt-10';
const NICKNAME_TEXT_CLASS = 'text-xl font-semibold tracking-tight sm:text-2xl';
const AVATAR_CLASS = 'h-16 w-16 sm:h-20 sm:w-20';
const STAT_CLASS =
  'inline-flex items-baseline gap-1 text-gray-500 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100';
const STAT_VALUE_CLASS = 'font-semibold tabular-nums';
// 横幅离开 /me 会卸载；回来时先展示上次的数字再静默刷新，只有首次加载才出现占位
const knownStats = new Map<string, MineStats>();
const ACTION_CLASS =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-gray-900/[0.05] px-4 text-sm text-gray-700 transition hover:bg-gray-900/[0.09] dark:bg-white/[0.07] dark:text-gray-200 dark:hover:bg-white/[0.12]';

function StatValue({ value }: { value: number | null | undefined }) {
  if (value === undefined) {
    return <SkeletonNumber className={STAT_VALUE_CLASS} />;
  }
  return (
    <span className={`${STAT_VALUE_CLASS} text-gray-900 dark:text-gray-100`}>
      {value ?? '–'}
    </span>
  );
}

export function MineProfileHeaderSkeleton() {
  return (
    <div aria-hidden='true' className={BANNER_CLASS}>
      <div className={`${AVATAR_CLASS} skeleton shrink-0 rounded-full`} />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1'>
          <SkeletonText
            className={`min-w-0 ${NICKNAME_TEXT_CLASS}`}
            barClassName='h-6 w-36 max-w-full rounded'
          />
          <span className='h-8 w-8 shrink-0 md:hidden' />
        </div>
        <div className='mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm'>
          {['评价', '关注', '粉丝'].map((label) => (
            <span key={label} className={STAT_CLASS}>
              <StatValue value={undefined} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className='hidden shrink-0 items-center gap-2 md:flex'>
        <div className='skeleton h-9 w-[106px] rounded-full' />
        <div className='skeleton h-9 w-[108px] rounded-full' />
      </div>
    </div>
  );
}

// actions 只在窄屏渲染在昵称行末尾，宽屏由顶栏提供同类入口
export function MineProfileHeader({ actions }: { actions?: ReactNode }) {
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;
  // undefined 表示加载中，null 表示加载失败
  const [stats, setStats] = useState<MineStats | null | undefined>(() =>
    profileId ? knownStats.get(profileId) : undefined,
  );
  const [list, setList] = useState<'followers' | 'following' | null>(null);
  const [editing, setEditing] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      Promise.all([getUserProfile(profileId), fetchMyVideoReviewCount()])
        .then(([profile, count]) => {
          if (!active || current !== generation) return;
          const next = {
            reviews: count,
            following: profile.followingCount,
            followers: profile.followerCount,
          };
          knownStats.set(profileId, next);
          rememberMyReviewCount(profileId, count);
          setStats(next);
        })
        .catch(() => {
          // 已有数字时刷新失败保留原值，不把可用数据换成失败占位
          if (active && current === generation && !knownStats.has(profileId))
            setStats(null);
        });
    };
    setStats(knownStats.get(profileId));
    refresh();
    window.addEventListener(VIDEO_REVIEWS_UPDATED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(VIDEO_REVIEWS_UPDATED_EVENT, refresh);
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
        <ProfileAvatar user={session} className={AVATAR_CLASS} />
      </Link>

      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1'>
          <h1
            className={`min-w-0 truncate ${NICKNAME_TEXT_CLASS} text-gray-900 dark:text-gray-50`}
          >
            <Link href={profileHref}>{nickname}</Link>
          </h1>
          {session.level && (
            <button
              type='button'
              aria-label='查看观影等级'
              onClick={() => setLevelOpen(true)}
              className='ml-1 shrink-0 rounded transition active:scale-95'
            >
              <WatchLevelBadge level={session.level} size='md' />
            </button>
          )}
          <button
            type='button'
            aria-label='编辑资料'
            onClick={() => setEditing(true)}
            className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition active:scale-90 dark:text-gray-500 md:hidden'
          >
            <PenLine aria-hidden='true' className='h-4 w-4' />
          </button>
          {actions && (
            <div className='-my-1 -mr-2 ml-auto flex shrink-0 items-center text-gray-700 dark:text-gray-200 md:hidden'>
              {actions}
            </div>
          )}
        </div>
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

      <div className='hidden shrink-0 items-center gap-2 md:flex'>
        <button
          type='button'
          onClick={() => setEditing(true)}
          className={ACTION_CLASS}
        >
          <PenLine aria-hidden='true' className='h-3.5 w-3.5' />
          编辑资料
        </button>
        <Link href={profileHref} className={ACTION_CLASS}>
          个人主页
          <ChevronRight aria-hidden='true' className='-mr-1 h-4 w-4' />
        </Link>
      </div>

      <FollowList
        isOpen={Boolean(list)}
        profileId={profileId}
        type={list}
        onClose={() => setList(null)}
      />
      {levelOpen && <WatchLevelPanel onClose={() => setLevelOpen(false)} />}
      {editing && (
        <ProfilePanel
          showSuccessToast={false}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}
