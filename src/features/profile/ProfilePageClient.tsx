'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import CoverImage from '@/components/CoverImage';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { SIDEBAR_POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import PublicReviewContent, {
  PUBLIC_REVIEW_BODY_SPACING_CLASS,
  PUBLIC_REVIEW_BODY_TEXT_CLASS,
  PUBLIC_REVIEW_META_CLASS,
  PUBLIC_REVIEW_TIME_TEXT_CLASS,
} from '@/components/PublicReviewContent';
import SkeletonText from '@/components/SkeletonText';
import Spinner from '@/components/Spinner';
import { ProfilePanel } from '@/components/user-menu/ProfilePanel';
import { WATCH_STATUS_OPTIONS } from '@/components/watch-record-context';
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
import {
  ProfileHero,
  ProfileHeroSkeleton,
} from '@/features/profile/ProfileHero';
import { useSlidingIndicator } from '@/hooks/useSlidingIndicator';
import {
  getKnownPublicReviewCount,
  getUserFavorites,
  getUserProfile,
  getUserReviews,
  PROFILE_UPDATED_EVENT,
  rememberPublicReviewCount,
  setFollowing,
} from '@/lib/profile.client';
import type {
  FavoriteWatchStatus,
  LibraryVisibility,
  UserProfileView,
} from '@/lib/types';
import { replaceSearchParamInUrl } from '@/lib/url-search-param';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';
import { parseStorageKey } from '@/lib/utils';

const REVIEW_TITLE_TEXT_CLASS = 'mb-1.5';
const TABS_CLASS =
  'relative mb-6 flex gap-7 border-b border-gray-200/80 dark:border-white/[0.08]';
const TAB_CLASS = 'relative -mb-px py-3 text-[15px] transition-colors';
const TAB_INDICATOR_CLASS = 'h-0.5 rounded-full bg-brand-500 dark:bg-brand-400';
const LIST_SKELETON_LIMIT = 20;
const PROFILE_TABS = [
  ['reviews', '评价'],
  ['favorites', '收藏'],
  ['lists', '片单'],
] as const;
type ProfileTab = (typeof PROFILE_TABS)[number][0];
const DEFAULT_PROFILE_TAB: ProfileTab = 'reviews';
function parseProfileTab(value: string | null | undefined): ProfileTab {
  return (
    PROFILE_TABS.find(([tab]) => tab === value)?.[0] ?? DEFAULT_PROFILE_TAB
  );
}
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
        <ReadOnlyFavoriteGridSkeleton
          count={skeletonCount(favoriteCount)}
          gridClassName={SIDEBAR_POSTER_GRID_CLASS}
        />
      ) : (
        <div
          aria-busy={refreshing}
          className={`transition-opacity ${refreshing ? 'pointer-events-none opacity-60' : ''}`}
        >
          <FavoriteGrid
            readOnly
            gridClassName={SIDEBAR_POSTER_GRID_CLASS}
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

// 桌面端左侧资料卡、右侧内容；窄屏上下堆叠
const PROFILE_LAYOUT_CLASS =
  'lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-10';
const PROFILE_MAIN_CLASS = 'min-w-0';

// 评价数未知时不编造骨架条数，内容区只转圈
function ProfileHeaderSkeleton({ profileId }: { profileId: string }) {
  const reviewCount = getKnownPublicReviewCount(profileId);
  return (
    <div aria-label='加载中' role='status' className={PROFILE_LAYOUT_CLASS}>
      <ProfileHeroSkeleton />
      <div className={PROFILE_MAIN_CLASS}>
        <div className={TABS_CLASS}>
          {PROFILE_TABS.map(([value, label]) => (
            <span key={value} className={`${TAB_CLASS} text-gray-500`}>
              {label}
            </span>
          ))}
        </div>
        {reviewCount === null ? (
          <div className='flex justify-center py-12'>
            <Spinner className='h-6 w-6' />
          </div>
        ) : (
          <ProfileReviewsSkeleton count={skeletonCount(reviewCount)} />
        )}
      </div>
    </div>
  );
}

function ProfilePageFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <PageLayout activePath='/me' mobileHeader={{ title, showBack: true }}>
      <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-4 sm:pt-10`}>
        <div className='mx-auto max-w-4xl lg:max-w-6xl'>{children}</div>
      </div>
    </PageLayout>
  );
}

// 路由 loading 与页面内资料加载共用，点击入口后立即切到个人主页外壳
export function ProfilePageSkeleton({ profileId }: { profileId: string }) {
  return (
    <ProfilePageFrame title='个人主页'>
      <ProfileHeaderSkeleton profileId={profileId} />
    </ProfilePageFrame>
  );
}

function ProfileTabs({
  tab,
  onChange,
}: {
  tab: ProfileTab;
  onChange: (tab: ProfileTab) => void;
}) {
  const indicator = useSlidingIndicator<HTMLDivElement>(tab);
  return (
    <div
      ref={indicator.containerRef}
      role='tablist'
      aria-label='个人主页内容'
      className={TABS_CLASS}
    >
      {PROFILE_TABS.map(([value, label]) => {
        const selected = tab === value;
        return (
          <button
            key={value}
            type='button'
            role='tab'
            aria-selected={selected}
            data-indicator-target={selected || undefined}
            onClick={() => onChange(value)}
            className={`${TAB_CLASS} ${
              selected
                ? 'font-semibold text-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            {label}
            {selected && !indicator.indicatorProps && (
              <span
                className={`absolute inset-x-0 bottom-0 ${TAB_INDICATOR_CLASS}`}
              />
            )}
          </button>
        );
      })}
      {indicator.indicatorProps && (
        <span
          aria-hidden='true'
          className='sliding-indicator -mt-0.5 h-0.5'
          {...indicator.indicatorProps}
        >
          <span className={`block h-full ${TAB_INDICATOR_CLASS}`} />
        </span>
      )}
    </div>
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
  // 标签写进地址栏，从片单等详情页返回时回到原标签
  const searchParams = useSearchParams();
  const [tab, setTabState] = useState(() =>
    parseProfileTab(searchParams?.get('tab')),
  );
  const setTab = (next: ProfileTab) => {
    setTabState(next);
    replaceSearchParamInUrl('tab', next === DEFAULT_PROFILE_TAB ? null : next);
  };
  const [list, setList] = useState<'followers' | 'following' | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const following = useRef(false);
  useEffect(() => {
    // 服务端已预取同一用户时首轮不再请求，version 变化后照常重新拉取
    if (version === 0 && initialProfile?.profileId === profileId) {
      rememberPublicReviewCount(profileId, initialProfile.publicReviewCount);
      return;
    }
    let active = true;
    setError('');
    getUserProfile(profileId)
      .then((value) => {
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
  const isSelf = profile?.isSelf === true;
  useEffect(() => {
    if (!isSelf) return;
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener(PROFILE_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, refresh);
  }, [isSelf]);
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
    <ProfilePageFrame title={profile?.nickname ?? '个人主页'}>
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
        <div className={PROFILE_LAYOUT_CLASS}>
          <ProfileHero
            profile={profile}
            profileId={profileId}
            busy={busy}
            onFollow={() => void follow()}
            onEdit={() => setEditing(true)}
            onShowReviews={() => setTab('reviews')}
            onOpenList={setList}
            onShowcaseChange={(showcase) =>
              setProfile((current) => current && { ...current, showcase })
            }
          />
          <div className={PROFILE_MAIN_CLASS}>
            <ProfileTabs tab={tab} onChange={setTab} />
            {tab === 'lists' ? (
              <ProfileLists
                key={`${profileId}:${version}`}
                profileId={profileId}
                isSelf={profile.isSelf}
                skeletonCount={skeletonCount(profile.listCount)}
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
          </div>
          <FollowList
            isOpen={Boolean(list)}
            profileId={profileId}
            type={list}
            count={
              list === 'followers'
                ? profile.followerCount
                : profile.followingCount
            }
            onClose={() => setList(null)}
          />
          {editing && (
            <ProfilePanel
              showSuccessToast={false}
              onClose={() => setEditing(false)}
            />
          )}
        </div>
      ) : (
        !error && <ProfileHeaderSkeleton profileId={profileId} />
      )}
    </ProfilePageFrame>
  );
}
