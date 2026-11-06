'use client';

import { UserCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import ProfileAvatar from '@/components/ProfileAvatar';
import PublicReviewContent, {
  PUBLIC_REVIEW_BODY_SPACING_CLASS,
  PUBLIC_REVIEW_BODY_TEXT_CLASS,
  PUBLIC_REVIEW_META_CLASS,
  PUBLIC_REVIEW_TIME_TEXT_CLASS,
} from '@/components/PublicReviewContent';
import SkeletonText from '@/components/SkeletonText';
import { ProfilePanel } from '@/components/user-menu/ProfilePanel';
import { WATCH_STATUS_OPTIONS } from '@/components/watch-record-context';
import {
  FavoriteGrid,
  ReadOnlyFavoriteGridSkeleton,
} from '@/features/favorites/components/FavoriteGrid';
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
import type {
  FavoriteWatchStatus,
  LibraryVisibility,
  UserProfileView,
} from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

const REVIEW_TITLE_TEXT_CLASS = 'mb-1.5';
const NICKNAME_TEXT_CLASS = 'text-2xl font-semibold';
const PROFILE_STATS_CLASS = 'mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm';

function playUrl(review: { title: string; year: string }) {
  return `/play?${new URLSearchParams({ title: review.title, year: review.year })}`;
}

function ProfileReviews({
  profileId,
  isSelf,
  reviewCount,
}: {
  profileId: string;
  isSelf: boolean;
  reviewCount: number;
}) {
  const load = useCallback(
    (cursor: string | null) => getUserReviews(profileId, cursor),
    [profileId],
  );
  const page = useProfilePage(load);
  return (
    <div className='space-y-3'>
      {page.loading && page.items.length === 0 && (
        <ProfileReviewsSkeleton count={Math.min(reviewCount, 20)} />
      )}
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
            <h2 className={`${REVIEW_TITLE_TEXT_CLASS} truncate`}>
              <Link
                href={playUrl(review)}
                className='font-semibold text-gray-900 transition hover:text-brand-600 dark:text-gray-100 dark:hover:text-brand-400'
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
const PROFILE_FAVORITE_FILTERS: {
  value: 'all' | FavoriteWatchStatus;
  label: string;
}[] = [{ value: 'all', label: '全部' }, ...WATCH_STATUS_OPTIONS];

function ProfileFavorites({
  profileId,
  initialVisibility,
}: {
  profileId: string;
  initialVisibility: LibraryVisibility;
}) {
  // 资料已带公开等级，首屏即按它渲染筛选条，避免数据返回后内容下移
  const [hidden, setHidden] = useState(initialVisibility === 0);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [filter, setFilter] = useState<'all' | FavoriteWatchStatus>('all');
  const load = useCallback(
    async (cursor: string | null) => {
      const result = await getUserFavorites(profileId, cursor, filter);
      setHidden(result.hidden);
      setVisibility(result.libraryVisibility);
      return result.hidden ? { items: [], nextCursor: null } : result;
    },
    [profileId, filter],
  );
  const page = useProfilePage(load, { keepItems: true });
  const refreshing = page.loading && page.items.length > 0 && !page.cursor;
  if (hidden) {
    return (
      <p className='py-16 text-center text-sm text-gray-500'>
        这位用户暂未公开收藏
      </p>
    );
  }
  return (
    <>
      {visibility >= 2 && (
        <div
          role='group'
          aria-label='观看状态'
          className='-mx-2 mb-5 flex gap-1.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        >
          {PROFILE_FAVORITE_FILTERS.map((option) => {
            const active = option.value === filter;
            return (
              <button
                key={option.value}
                type='button'
                aria-pressed={active}
                onClick={() => setFilter(option.value)}
                className={`inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-medium transition ${
                  active
                    ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900'
                    : 'bg-white/75 text-gray-600 ring-1 ring-inset ring-black/[0.06] hover:bg-white hover:text-gray-900 dark:bg-white/[0.06] dark:text-gray-300 dark:ring-white/[0.06] dark:hover:bg-white/10 dark:hover:text-white'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
      {page.loading && page.items.length === 0 ? (
        <ReadOnlyFavoriteGridSkeleton count={12} />
      ) : (
        <div
          aria-busy={refreshing}
          className={`transition-opacity ${refreshing ? 'pointer-events-none opacity-60' : ''}`}
        >
          <FavoriteGrid
            readOnly
            emptyText={filter === 'all' ? '暂无收藏内容' : '没有符合条件的作品'}
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
                      watchStatus: item.watchStatus,
                      myRating: item.rating ?? undefined,
                    },
                  ]
                : [];
            })}
          />
        </div>
      )}
      <PageFooter {...page} loading={page.loading && !refreshing} />
    </>
  );
}
function ProfileReviewsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className='space-y-3' role='status' aria-label='加载中'>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className='flex gap-4 rounded-2xl bg-white p-4 ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10'
        >
          <div className='skeleton aspect-[2/3] w-16 shrink-0 self-start rounded-lg sm:w-20' />
          <div className='min-w-0 flex-1'>
            <SkeletonText
              className={REVIEW_TITLE_TEXT_CLASS}
              barClassName='h-4 w-1/2 rounded'
            />
            <div className={PUBLIC_REVIEW_META_CLASS}>
              <SkeletonText
                className={PUBLIC_REVIEW_TIME_TEXT_CLASS}
                barClassName='h-4 w-24 rounded'
              />
            </div>
            <div className={PUBLIC_REVIEW_BODY_SPACING_CLASS}>
              <SkeletonText
                className={PUBLIC_REVIEW_BODY_TEXT_CLASS}
                barClassName='h-4 w-full rounded'
              />
              <SkeletonText
                className={PUBLIC_REVIEW_BODY_TEXT_CLASS}
                barClassName='h-4 w-3/4 rounded'
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfileHeaderSkeleton() {
  return (
    <div aria-label='加载中' role='status'>
      <div className='mb-6 flex flex-wrap items-center gap-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10'>
        <div className='skeleton h-16 w-16 shrink-0 rounded-full' />
        <div className='min-w-0 flex-1'>
          <SkeletonText
            className={NICKNAME_TEXT_CLASS}
            barClassName='h-6 w-36 max-w-full rounded'
          />
          <div className={PROFILE_STATS_CLASS}>
            {Array.from({ length: 3 }, (_, index) => (
              <SkeletonText key={index} barClassName='h-4 w-10 rounded' />
            ))}
          </div>
        </div>
        <div className='skeleton h-9 w-[88px] rounded-xl' />
      </div>
      <div className='mb-6 flex gap-2 border-b border-gray-200 dark:border-white/10'>
        {['评价', '收藏'].map((label) => (
          <span
            key={label}
            className='border-b-2 border-transparent px-5 py-3 text-sm text-gray-500'
          >
            {label}
          </span>
        ))}
      </div>
      <ProfileReviewsSkeleton />
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
      <main className={`${PAGE_CONTAINER_CLASS} pb-8 pt-4 sm:pt-10`}>
        <div className='mx-auto max-w-4xl'>
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
                  <ProfileAvatar user={profile} className='h-16 w-16' />
                  <div className='min-w-0 flex-1'>
                    <h1
                      className={`break-words ${NICKNAME_TEXT_CLASS} text-gray-900 dark:text-gray-100`}
                    >
                      {profile.nickname ?? '未设置昵称'}
                    </h1>
                    <div
                      className={`${PROFILE_STATS_CLASS} text-gray-500 dark:text-gray-400`}
                    >
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
                          : 'inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50'
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
                    className={`border-b-2 px-5 py-3 text-sm ${tab === value ? 'border-brand-600 font-semibold text-brand-600 dark:text-brand-400' : 'border-transparent text-gray-500'}`}
                  >
                    {value === 'reviews' ? '评价' : '收藏'}
                  </button>
                ))}
              </div>
              {tab === 'reviews' ? (
                <ProfileReviews
                  profileId={profileId}
                  isSelf={profile.isSelf}
                  reviewCount={profile.publicReviewCount}
                />
              ) : (
                <ProfileFavorites
                  key={`${profileId}:${version}`}
                  profileId={profileId}
                  initialVisibility={
                    profile.isSelf ? 3 : profile.libraryVisibility
                  }
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
        </div>
      </main>
    </PageLayout>
  );
}
