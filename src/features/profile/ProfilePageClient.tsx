'use client';

import { Link2, UserCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import AnimatedCount from '@/components/AnimatedCount';
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
import SkeletonText, { SkeletonNumber } from '@/components/SkeletonText';
import { ProfilePanel } from '@/components/user-menu/ProfilePanel';
import { WATCH_STATUS_OPTIONS } from '@/components/watch-record-context';
import { RecapEntryLink } from '@/features/annual-report/components/RecapEntryLink';
import {
  FavoriteGrid,
  ReadOnlyFavoriteGridSkeleton,
} from '@/features/favorites/components/FavoriteGrid';
import { ProfileLists } from '@/features/lists/components/ProfileLists';
import {
  FollowList,
  PageFooter,
  profileButtonClass as buttonClass,
} from '@/features/profile/FollowList';
import { useProfilePage } from '@/features/profile/hooks/useProfilePage';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  getUserFavorites,
  getUserProfile,
  getUserReviews,
  setFollowing,
} from '@/lib/profile.client';
import { showToast } from '@/lib/toast';
import type {
  FavoriteWatchStatus,
  LibraryVisibility,
  UserProfileView,
} from '@/lib/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';
import { parseStorageKey } from '@/lib/utils';

const REVIEW_TITLE_TEXT_CLASS = 'mb-1.5';
const NICKNAME_TEXT_CLASS = 'text-2xl font-semibold';
const PROFILE_STATS_CLASS = 'mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm';
const PROFILE_STAT_VALUE_CLASS = 'mr-1 font-semibold tabular-nums';
const PROFILE_STAT_LABELS = ['评价', '关注', '粉丝'] as const;
const LIST_SKELETON_LIMIT = 20;
const PROFILE_TABS = [
  ['reviews', '评价'],
  ['favorites', '收藏'],
  ['lists', '片单'],
] as const;
type ProfileTab = (typeof PROFILE_TABS)[number][0];
const DEFAULT_REVIEW_SKELETON_COUNT = 3;
// 资料返回前无从得知评价数，沿用本次会话里上次看到的数量
const knownReviewCounts = new Map<string, number>();

function skeletonCount(count: number) {
  return Math.min(count, LIST_SKELETON_LIMIT);
}

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
  const initialLoading = page.loading && page.items.length === 0;
  return (
    <div className='space-y-3'>
      {initialLoading && (
        <ProfileReviewsSkeleton count={skeletonCount(reviewCount)} />
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
      {(initialLoading
        ? reviewCount === 0
        : !page.error && page.items.length === 0) && (
        <p className='py-16 text-center text-sm text-gray-500'>
          还没有公开评价
        </p>
      )}
      <PageFooter {...page} loading={page.loading && !initialLoading} />
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
  favoriteCount,
}: {
  profileId: string;
  initialVisibility: LibraryVisibility;
  favoriteCount: number;
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
  const initialLoading = page.loading && page.items.length === 0;
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
      {initialLoading && favoriteCount > 0 ? (
        <ReadOnlyFavoriteGridSkeleton count={skeletonCount(favoriteCount)} />
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
      <PageFooter
        {...page}
        loading={page.loading && !refreshing && !initialLoading}
      />
    </>
  );
}
function ProfileReviewsSkeleton({ count }: { count: number }) {
  if (count === 0) return null;
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

function ProfileHeaderSkeleton({ reviewCount }: { reviewCount: number }) {
  return (
    <div aria-label='加载中' role='status'>
      <div className='mb-6 flex flex-wrap items-center gap-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10'>
        <div className='skeleton h-16 w-16 shrink-0 rounded-full' />
        <div className='min-w-0 flex-1'>
          <SkeletonText
            className={NICKNAME_TEXT_CLASS}
            barClassName='h-6 w-36 max-w-full rounded'
          />
          <div className={`${PROFILE_STATS_CLASS} text-gray-500`}>
            {PROFILE_STAT_LABELS.map((label) => (
              <span key={label}>
                <SkeletonNumber className={PROFILE_STAT_VALUE_CLASS} />
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <div className='skeleton h-9 w-9 rounded-xl' />
          <div className='skeleton h-9 w-[88px] rounded-xl' />
        </div>
      </div>
      <div className='mb-6 flex gap-2 border-b border-gray-200 dark:border-white/10'>
        {['评价', '收藏', '片单'].map((label) => (
          <span
            key={label}
            className='border-b-2 border-transparent px-5 py-3 text-sm text-gray-500'
          >
            {label}
          </span>
        ))}
      </div>
      <ProfileReviewsSkeleton count={skeletonCount(reviewCount)} />
    </div>
  );
}

function CopyProfileLinkButton({ profileId }: { profileId: string }) {
  async function copy() {
    const ok = await copyTextToClipboard(
      `${window.location.origin}/u/${profileId}`,
    );
    if (ok) showToast('已复制主页链接', 'success');
    else showToast('复制失败，请手动复制地址栏中的链接', 'error');
  }

  return (
    <button
      type='button'
      onClick={() => void copy()}
      aria-label='复制主页链接'
      title='复制主页链接'
      className='flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15'
    >
      <Link2 className='h-4 w-4' />
    </button>
  );
}

export default function ProfilePageClient({
  profileId,
  initialProfile = null,
}: {
  profileId: string;
  initialProfile?: UserProfileView | null;
}) {
  const [profile, setProfile] = useState<UserProfileView | null>(
    initialProfile,
  );
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<ProfileTab>('reviews');
  const [list, setList] = useState<'followers' | 'following' | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const following = useRef(false);
  useEffect(() => {
    // 服务端已预取同一用户时首轮不再请求，version 变化后照常重新拉取
    if (version === 0 && initialProfile?.profileId === profileId) {
      knownReviewCounts.set(profileId, initialProfile.publicReviewCount);
      return;
    }
    let active = true;
    setError('');
    getUserProfile(profileId)
      .then((value) => {
        knownReviewCounts.set(profileId, value.publicReviewCount);
        if (active) setProfile(value);
      })
      .catch((error) => {
        if (active)
          if (!isAbortError(error))
            setError(getErrorMessage(error, '操作失败，请稍后重试'));
      });
    return () => {
      active = false;
    };
  }, [initialProfile, profileId, version]);
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
      if (!isAbortError(error))
        setError(getErrorMessage(error, '操作失败，请稍后重试'));
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
      <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-4 sm:pt-10`}>
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
                          <span
                            className={`${PROFILE_STAT_VALUE_CLASS} text-gray-900 dark:text-gray-100`}
                          >
                            <AnimatedCount key={profileId} value={count} />
                          </span>
                          {label}
                        </button>
                      ))}
                      {profile.recap && (
                        <RecapEntryLink
                          href={`/u/${encodeURIComponent(profileId)}/recap/${profile.recap.year}`}
                          year={profile.recap.year}
                          className='-my-1'
                        />
                      )}
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <CopyProfileLinkButton profileId={profileId} />
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
                </div>
              </header>
              <div
                role='tablist'
                aria-label='个人主页内容'
                className='mb-6 flex gap-2 border-b border-gray-200 dark:border-white/10'
              >
                {PROFILE_TABS.map(([value, label]) => (
                  <button
                    key={value}
                    type='button'
                    role='tab'
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={`border-b-2 px-5 py-3 text-sm ${tab === value ? 'border-brand-600 font-semibold text-brand-600 dark:text-brand-400' : 'border-transparent text-gray-500'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'lists' ? (
                <ProfileLists
                  key={`${profileId}:${version}`}
                  profileId={profileId}
                  isSelf={profile.isSelf}
                />
              ) : tab === 'reviews' ? (
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
                  favoriteCount={profile.favoriteCount}
                />
              )}
              <FollowList
                isOpen={Boolean(list)}
                profileId={profileId}
                type={list}
                onClose={() => setList(null)}
              />
              {editing && (
                <ProfilePanel
                  showSuccessToast={false}
                  onClose={() => {
                    setEditing(false);
                    setVersion((value) => value + 1);
                  }}
                />
              )}
            </>
          ) : (
            !error && (
              <ProfileHeaderSkeleton
                reviewCount={
                  knownReviewCounts.get(profileId) ??
                  DEFAULT_REVIEW_SKELETON_COUNT
                }
              />
            )
          )}
        </div>
      </div>
    </PageLayout>
  );
}
