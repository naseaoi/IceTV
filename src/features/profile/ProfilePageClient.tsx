'use client';

import { UserCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import PageLayout from '@/components/PageLayout';
import ProfileAvatar from '@/components/ProfileAvatar';
import PublicReviewContent from '@/components/PublicReviewContent';
import { ProfilePanel } from '@/components/user-menu/ProfilePanel';
import { FavoriteGrid } from '@/features/favorites/components/FavoriteGrid';
import {
  FollowList,
  PageFooter,
  profileButtonClass as buttonClass,
} from '@/features/profile/FollowList';
import { useProfilePage } from '@/features/profile/hooks/useProfilePage';
import {
  getUserFavorites,
  getUserProfile,
  getUserReviews,
  setFollowing,
} from '@/lib/profile.client';
import type { UserProfileView } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

function playUrl(review: { title: string; year: string }) {
  return `/play?${new URLSearchParams({ title: review.title, year: review.year })}`;
}

function ProfileReviews({
  profileId,
  isSelf,
}: {
  profileId: string;
  isSelf: boolean;
}) {
  const load = useCallback(
    (cursor: string | null) => getUserReviews(profileId, cursor),
    [profileId],
  );
  const page = useProfilePage(load);
  return (
    <div className='space-y-3'>
      {page.items.map((review) => (
        <article
          key={`${review.title_norm}:${review.year}`}
          className='flex gap-4 rounded-2xl bg-white p-4 ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10'
        >
          <Link
            href={playUrl(review)}
            aria-label={`播放${review.title}`}
            className='relative aspect-[2/3] w-16 shrink-0 self-start overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 sm:w-20'
          >
            <CoverImage src={review.cover} alt={review.title} sizes='80px' />
          </Link>
          <div className='min-w-0 flex-1'>
            <h2 className='mb-1.5 truncate'>
              <Link
                href={playUrl(review)}
                className='font-semibold text-gray-900 transition hover:text-green-600 dark:text-gray-100 dark:hover:text-green-400'
              >
                {review.title}
              </Link>
              {review.year && (
                <span className='ml-1.5 text-xs text-gray-500'>
                  {review.year}
                </span>
              )}
            </h2>
            <PublicReviewContent review={review} isMine={isSelf} hideAuthor />
          </div>
        </article>
      ))}
      {!page.loading && !page.error && page.items.length === 0 && (
        <p className='py-16 text-center text-sm text-gray-500'>
          还没有公开评价
        </p>
      )}
      <PageFooter {...page} />
    </div>
  );
}
function ProfileFavorites({ profileId }: { profileId: string }) {
  const [hidden, setHidden] = useState(false);
  const load = useCallback(
    async (cursor: string | null) => {
      const result = await getUserFavorites(profileId, cursor);
      setHidden(result.hidden);
      return result.hidden ? { items: [], nextCursor: null } : result;
    },
    [profileId],
  );
  const page = useProfilePage(load);
  return hidden ? (
    <p className='py-16 text-center text-sm text-gray-500'>
      这位用户暂未公开收藏
    </p>
  ) : (
    <>
      <FavoriteGrid
        readOnly
        items={page.items.flatMap((item) => {
          const parsed = parseStorageKey(item.key);
          return parsed
            ? [
                {
                  ...parsed,
                  title: item.title,
                  year: item.year,
                  poster: item.cover,
                  source_name: item.source_name,
                  episodes: item.total_episodes,
                  search_title: item.search_title,
                },
              ]
            : [];
        })}
      />
      <PageFooter {...page} />
    </>
  );
}
function ProfileHeaderSkeleton() {
  return (
    <div aria-label='加载中' role='status'>
      <div className='mb-6 flex items-center gap-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10'>
        <div className='h-16 w-16 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-white/10' />
        <div className='flex-1 space-y-3'>
          <div className='h-6 w-36 animate-pulse rounded bg-gray-200 dark:bg-white/10' />
          <div className='h-4 w-48 animate-pulse rounded bg-gray-200 dark:bg-white/10' />
        </div>
      </div>
      <div className='mb-6 h-[45px] border-b border-gray-200 dark:border-white/10' />
    </div>
  );
}

export default function ProfilePageClient({
  profileId,
}: {
  profileId: string;
}) {
  const [profile, setProfile] = useState<UserProfileView | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<'reviews' | 'favorites'>('reviews');
  const [list, setList] = useState<'followers' | 'following' | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const following = useRef(false);
  useEffect(() => {
    let active = true;
    setError('');
    getUserProfile(profileId)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((error) => {
        if (active) setError((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [profileId, version]);
  async function follow() {
    if (!profile || following.current) return;
    following.current = true;
    setBusy(true);
    setError('');
    const previous = profile;
    setProfile({
      ...profile,
      isFollowing: !profile.isFollowing,
      followerCount: Math.max(
        0,
        profile.followerCount + (profile.isFollowing ? -1 : 1),
      ),
    });
    try {
      const result = await setFollowing(profileId, !previous.isFollowing);
      setProfile(
        (current) =>
          current && {
            ...current,
            isFollowing: result.following,
            followerCount: result.followerCount,
          },
      );
    } catch (error) {
      setProfile(previous);
      setError((error as Error).message);
    } finally {
      following.current = false;
      setBusy(false);
    }
  }
  return (
    <PageLayout
      activePath='/me'
      mobileHeader={{ title: profile?.nickname ?? '个人主页', showBack: true }}
    >
      <main className='mx-auto w-full max-w-4xl px-3 pb-8 pt-4 sm:px-8 sm:pt-10'>
        {error && (
          <div
            role='alert'
            className='mb-4 flex items-center gap-3 text-sm text-red-500'
          >
            {error}
            {!profile && (
              <button
                type='button'
                className={buttonClass}
                onClick={() => setVersion((value) => value + 1)}
              >
                重试
              </button>
            )}
          </div>
        )}
        {profile ? (
          <>
            <header className='mb-6 rounded-2xl bg-white p-5 ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10'>
              <div className='flex flex-wrap items-center gap-4'>
                <ProfileAvatar {...profile} className='h-16 w-16 text-2xl' />
                <div className='min-w-0 flex-1'>
                  <h1 className='break-words text-2xl font-semibold text-gray-900 dark:text-gray-100'>
                    {profile.nickname ?? '未设置昵称'}
                  </h1>
                  <div className='mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500 dark:text-gray-400'>
                    {(
                      [
                        [
                          profile.publicReviewCount,
                          '评价',
                          () => setTab('reviews'),
                        ],
                        [
                          profile.followingCount,
                          '关注',
                          () => setList('following'),
                        ],
                        [
                          profile.followerCount,
                          '粉丝',
                          () => setList('followers'),
                        ],
                      ] as const
                    ).map(([count, label, onClick]) => (
                      <button
                        key={label}
                        type='button'
                        onClick={onClick}
                        className='transition hover:text-gray-900 dark:hover:text-gray-100'
                      >
                        <span className='mr-1 font-semibold tabular-nums text-gray-900 dark:text-gray-100'>
                          {count}
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {profile.isSelf ? (
                  <button
                    type='button'
                    onClick={() => setEditing(true)}
                    className={buttonClass}
                  >
                    编辑资料
                  </button>
                ) : (
                  <button
                    type='button'
                    disabled={busy}
                    aria-pressed={profile.isFollowing}
                    onClick={() => void follow()}
                    className={
                      profile.isFollowing
                        ? `inline-flex items-center gap-2 ${buttonClass}`
                        : 'inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50'
                    }
                  >
                    {profile.isFollowing ? (
                      <UserCheck className='h-4 w-4' />
                    ) : (
                      <UserPlus className='h-4 w-4' />
                    )}
                    {profile.isFollowing ? '已关注' : '关注'}
                  </button>
                )}
              </div>
            </header>
            <div
              role='tablist'
              aria-label='个人主页内容'
              className='mb-6 flex gap-2 border-b border-gray-200 dark:border-white/10'
            >
              {(['reviews', 'favorites'] as const).map((value) => (
                <button
                  key={value}
                  type='button'
                  role='tab'
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={`border-b-2 px-5 py-3 text-sm ${tab === value ? 'border-green-600 font-semibold text-green-600 dark:text-green-400' : 'border-transparent text-gray-500'}`}
                >
                  {value === 'reviews' ? '评价' : '收藏'}
                </button>
              ))}
            </div>
            {tab === 'reviews' ? (
              <ProfileReviews profileId={profileId} isSelf={profile.isSelf} />
            ) : (
              <ProfileFavorites
                key={`${profileId}:${version}`}
                profileId={profileId}
              />
            )}
            {list && (
              <FollowList
                profileId={profileId}
                type={list}
                onClose={() => setList(null)}
              />
            )}
            {editing && (
              <ProfilePanel
                onClose={() => {
                  setEditing(false);
                  setVersion((value) => value + 1);
                }}
              />
            )}
          </>
        ) : (
          !error && <ProfileHeaderSkeleton />
        )}
      </main>
    </PageLayout>
  );
}
