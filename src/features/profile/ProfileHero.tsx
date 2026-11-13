'use client';

import { Link2, PenLine, UserCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';

import AnimatedCount from '@/components/AnimatedCount';
import CoverImage from '@/components/CoverImage';
import ProfileAvatar, { ProfileAvatarArt } from '@/components/ProfileAvatar';
import SkeletonText, { SkeletonNumber } from '@/components/SkeletonText';
import { WatchLevelPanel } from '@/components/user-menu/lazy-panels';
import UserRoleBadge from '@/components/UserRoleBadge';
import WatchLevelBadge from '@/components/WatchLevelBadge';
import { RecapEntryLink } from '@/features/annual-report/components/RecapEntryLink';
import {
  ProfileShowcase,
  SECTION_LABEL_CLASS,
  SHOWCASE_COVER_CLASS,
  SHOWCASE_GRID_CLASS,
  SHOWCASE_HEADER_CLASS,
  SHOWCASE_TITLE_CLASS,
} from '@/features/profile/ProfileShowcase';
import {
  hasTasteMatchContent,
  TasteMatchChip,
} from '@/features/profile/TasteMatch';
import { copyTextToClipboard } from '@/lib/clipboard';
import { showToast } from '@/lib/toast';
import type { ProfileShowcaseItem, UserProfileView } from '@/lib/types';
import { SHOWCASE_MAX_ITEMS } from '@/lib/user-profile';

// 桌面端侧栏做成电影票根：资料为正券，本命为副券，分界处两侧挖半圆缺口
const HERO_CLASS =
  'ticket-outline relative mb-6 lg:mb-0 lg:[--stub-notch:12px]';
const SURFACE_CLASS = 'overflow-hidden bg-white dark:bg-gray-900';
const MAIN_CLASS = 'rounded-t-3xl lg:ticket-stub lg:[--stub-notch-y:100%]';
const STUB_CLASS =
  'relative rounded-b-3xl px-5 pb-5 pt-5 sm:px-8 sm:pb-7 lg:ticket-stub lg:bg-[#fafbfc] lg:px-6 lg:pb-6 lg:[--stub-notch-y:0%] lg:dark:bg-[#1c1e24]';
// 撕线两端紧贴缺口，留出与缺口半径相称的间隙
const PERFORATION_CLASS =
  'absolute inset-x-5 top-0 border-t border-gray-200/70 dark:border-white/[0.08] sm:inset-x-8 lg:inset-x-[18px] lg:h-[3px] lg:border-0 lg:ticket-perforation lg:text-gray-300 lg:dark:text-white/20';
const BANNER_CLASS = 'relative h-28 overflow-hidden sm:h-44 lg:h-28';
const TICKET_NO_CLASS =
  'absolute right-4 top-3 font-mono text-[11px] tracking-[0.18em] tabular-nums text-gray-500/80 sm:right-6 sm:top-4 lg:right-5 lg:top-3 dark:text-white/40';
// 横幅只做淡淡的点缀：整体压低饱和度与不透明度，向下渐隐到卡片底色
const BANNER_FADE_CLASS =
  'opacity-50 saturate-[.6] [mask-image:linear-gradient(to_bottom,black_20%,transparent)] dark:opacity-35';
const BODY_CLASS = 'relative px-5 pb-5 sm:px-8 sm:pb-7 lg:px-6 lg:pb-6';
// 头像与操作同行，昵称与徽章换到下一行
const AVATAR_ROW_CLASS =
  '-mt-10 flex flex-wrap items-end justify-between gap-x-3 sm:-mt-14 lg:-mt-10';
const IDENTITY_CLASS =
  'order-last flex basis-full flex-wrap items-center gap-x-2 gap-y-1';
const BADGES_CLASS = 'mt-3 flex items-center gap-1.5';
const AVATAR_FRAME_CLASS =
  'shrink-0 rounded-full bg-white p-1 shadow-sm dark:bg-gray-900';
const AVATAR_CLASS = 'h-20 w-20 sm:h-24 sm:w-24 lg:h-20 lg:w-20';
const ACTIONS_CLASS = 'flex items-center gap-2 pb-1';
const NICKNAME_CLASS =
  'mt-3 text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9 lg:text-2xl lg:leading-8';
const BIO_CLASS = 'mt-1.5 text-sm leading-6';
const STATS_CLASS =
  'mt-5 flex flex-wrap gap-x-7 gap-y-3 sm:gap-x-10 lg:justify-between lg:gap-x-4';
const STAT_VALUE_CLASS =
  'block text-xl font-semibold leading-7 tabular-nums sm:text-2xl sm:leading-8 lg:text-xl lg:leading-7';
const STAT_LABEL_CLASS = 'mt-0.5 block text-xs';
const ICON_BUTTON_CLASS =
  'flex h-9 w-9 items-center justify-center rounded-full bg-gray-900/[0.05] text-gray-600 transition hover:bg-gray-900/[0.09] dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.12]';
const PILL_BUTTON_CLASS =
  'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition disabled:opacity-50';
const SECONDARY_PILL_CLASS = `${PILL_BUTTON_CLASS} bg-gray-900/[0.05] text-gray-700 hover:bg-gray-900/[0.09] dark:bg-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.12]`;
const PRIMARY_PILL_CLASS = `${PILL_BUTTON_CLASS} bg-brand-600 text-white hover:bg-brand-500`;
const STAT_LABELS = ['观影小时', '评价', '关注', '粉丝'] as const;

// 票号只作装饰：由 profileId 稳定散列成 8 位数字，同一用户始终相同
function ticketNumber(profileId: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < profileId.length; i += 1) {
    hash ^= profileId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const digits = String(hash % 100_000_000).padStart(8, '0');
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

function ProfileBanner({
  profile,
}: {
  profile: Pick<UserProfileView, 'profileId' | 'avatarSeed'> & {
    showcase: ProfileShowcaseItem[];
  };
}) {
  const covers = profile.showcase;
  return (
    <div aria-hidden='true' className={BANNER_CLASS}>
      <div className={`absolute inset-0 ${BANNER_FADE_CLASS}`}>
        <ProfileAvatarArt
          user={profile}
          className='absolute left-1/2 top-1/2 aspect-square h-auto w-[140%] -translate-x-1/2 -translate-y-1/2 blur-2xl'
        />
        {covers.length > 0 && (
          <div className='absolute -inset-8 flex scale-110 blur-2xl'>
            {covers.map((item) => (
              <div key={item.key} className='relative flex-1'>
                <CoverImage src={item.cover} alt='' sizes='240px' />
              </div>
            ))}
          </div>
        )}
      </div>
      <span className={TICKET_NO_CLASS}>
        No. {ticketNumber(profile.profileId)}
      </span>
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
      className={ICON_BUTTON_CLASS}
    >
      <Link2 className='h-4 w-4' />
    </button>
  );
}

function Stat({
  value,
  label,
  onClick,
  animateKey,
}: {
  // null 表示未公开，以刮刮卡涂层占位
  value: number | null;
  label: string;
  onClick?: () => void;
  animateKey: string;
}) {
  const content = (
    <>
      <span className={`${STAT_VALUE_CLASS} text-gray-900 dark:text-gray-50`}>
        {value === null ? (
          <span className='relative inline-block' title='未公开'>
            <span className='invisible'>000</span>
            <span className='scratch-foil absolute inset-x-0 top-1/2 h-5 -translate-y-1/2 rounded' />
            <span className='sr-only'>未公开</span>
          </span>
        ) : (
          <AnimatedCount key={animateKey} value={value} />
        )}
      </span>{' '}
      <span
        className={`${STAT_LABEL_CLASS} text-gray-500 transition group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-gray-100`}
      >
        {label}
      </span>
    </>
  );
  return onClick ? (
    <button type='button' onClick={onClick} className='group text-left'>
      {content}
    </button>
  ) : (
    <div>{content}</div>
  );
}

export function ProfileHero({
  profile,
  profileId,
  busy,
  onFollow,
  onEdit,
  onShowReviews,
  onOpenList,
  onShowcaseChange,
}: {
  profile: UserProfileView;
  profileId: string;
  busy: boolean;
  onFollow: () => void;
  onEdit: () => void;
  onShowReviews: () => void;
  onOpenList: (type: 'followers' | 'following') => void;
  onShowcaseChange: (items: ProfileShowcaseItem[]) => void;
}) {
  const [levelOpen, setLevelOpen] = useState(false);
  const nickname = profile.nickname ?? '未设置昵称';
  const tasteMatch = hasTasteMatchContent(profile.tasteMatch)
    ? profile.tasteMatch
    : null;

  return (
    <header className={HERO_CLASS}>
      <div className={`${SURFACE_CLASS} ${MAIN_CLASS}`}>
        <ProfileBanner profile={profile} />
        <div className={BODY_CLASS}>
          <div className={AVATAR_ROW_CLASS}>
            <div className={AVATAR_FRAME_CLASS}>
              <ProfileAvatar user={profile} className={AVATAR_CLASS} />
            </div>
            <div className={IDENTITY_CLASS}>
              <h1
                className={`min-w-0 break-words ${NICKNAME_CLASS} text-gray-900 dark:text-gray-50`}
              >
                {nickname}
              </h1>
              <span className={BADGES_CLASS}>
                {profile.isSelf && profile.level ? (
                  <button
                    type='button'
                    aria-label='查看观影等级'
                    onClick={() => setLevelOpen(true)}
                    className='rounded transition active:scale-95'
                  >
                    <WatchLevelBadge level={profile.level} size='md' />
                  </button>
                ) : (
                  <WatchLevelBadge level={profile.level} size='md' />
                )}
                <UserRoleBadge role={profile.role} />
              </span>
            </div>
            <div className={ACTIONS_CLASS}>
              <CopyProfileLinkButton profileId={profileId} />
              {profile.isSelf ? (
                <button
                  type='button'
                  onClick={onEdit}
                  className={SECONDARY_PILL_CLASS}
                >
                  <PenLine aria-hidden='true' className='h-3.5 w-3.5' />
                  编辑资料
                </button>
              ) : (
                <button
                  type='button'
                  disabled={busy}
                  aria-pressed={profile.isFollowing}
                  onClick={onFollow}
                  className={
                    profile.isFollowing
                      ? SECONDARY_PILL_CLASS
                      : PRIMARY_PILL_CLASS
                  }
                >
                  {profile.isFollowing ? (
                    <UserCheck aria-hidden='true' className='h-4 w-4' />
                  ) : (
                    <UserPlus aria-hidden='true' className='h-4 w-4' />
                  )}
                  {profile.isFollowing ? '已关注' : '关注'}
                </button>
              )}
            </div>
          </div>

          {profile.bio ? (
            <p
              className={`${BIO_CLASS} break-words text-gray-600 dark:text-gray-300`}
            >
              {profile.bio}
            </p>
          ) : profile.isSelf ? (
            <button
              type='button'
              onClick={onEdit}
              className={`${BIO_CLASS} text-gray-400 transition hover:text-brand-600 dark:text-gray-500 dark:hover:text-brand-400`}
            >
              添加简介
            </button>
          ) : (
            <p className={`${BIO_CLASS} text-gray-400 dark:text-gray-500`}>
              暂无简介
            </p>
          )}

          <div className={STATS_CLASS}>
            <Stat
              value={profile.watchHours}
              label='观影小时'
              animateKey={profileId}
              onClick={profile.isSelf ? () => setLevelOpen(true) : undefined}
            />
            <Stat
              value={profile.publicReviewCount}
              label='评价'
              animateKey={profileId}
              onClick={onShowReviews}
            />
            <Stat
              value={profile.followingCount}
              label='关注'
              animateKey={profileId}
              onClick={() => onOpenList('following')}
            />
            <Stat
              value={profile.followerCount}
              label='粉丝'
              animateKey={profileId}
              onClick={() => onOpenList('followers')}
            />
          </div>

          {(profile.recap || tasteMatch) && (
            <div className='mt-4 flex flex-wrap items-center gap-2'>
              {profile.recap && (
                <RecapEntryLink
                  href={`/u/${encodeURIComponent(profileId)}/recap/${profile.recap.year}`}
                  year={profile.recap.year}
                />
              )}
              {tasteMatch && (
                <TasteMatchChip result={tasteMatch} nickname={nickname} />
              )}
            </div>
          )}
        </div>
      </div>
      <div className={`${SURFACE_CLASS} ${STUB_CLASS}`}>
        <span aria-hidden='true' className={PERFORATION_CLASS} />
        <ProfileShowcase
          items={profile.showcase}
          isSelf={profile.isSelf}
          favoriteCount={profile.favoriteCount}
          onChange={onShowcaseChange}
        />
      </div>
      {levelOpen && <WatchLevelPanel onClose={() => setLevelOpen(false)} />}
    </header>
  );
}

// 年度回顾与相合度随资料返回，骨架阶段无从得知，不预留附加信息行
export function ProfileHeroSkeleton() {
  return (
    <div aria-hidden='true' className={HERO_CLASS}>
      <div className={`${SURFACE_CLASS} ${MAIN_CLASS}`}>
        <div className={`${BANNER_CLASS} bg-gray-100 dark:bg-white/[0.04]`} />
        <div className={BODY_CLASS}>
          <div className={AVATAR_ROW_CLASS}>
            <div className={AVATAR_FRAME_CLASS}>
              <div className={`${AVATAR_CLASS} skeleton rounded-full`} />
            </div>
            <div className={IDENTITY_CLASS}>
              <SkeletonText
                className={NICKNAME_CLASS}
                barClassName='h-7 w-32 max-w-full rounded'
              />
              <span className={BADGES_CLASS}>
                <span className='skeleton h-5 w-12 rounded' />
              </span>
            </div>
            <div className={ACTIONS_CLASS}>
              <div className='skeleton h-9 w-9 rounded-full' />
              <div className='skeleton h-9 w-[92px] rounded-full' />
            </div>
          </div>
          <SkeletonText
            className={BIO_CLASS}
            barClassName='h-3.5 w-40 max-w-full rounded'
          />
          <div className={STATS_CLASS}>
            {STAT_LABELS.map((label) => (
              <div key={label}>
                <span className={STAT_VALUE_CLASS}>
                  <SkeletonNumber
                    digits={2}
                    className='font-semibold tabular-nums'
                    barClassName='h-5 rounded'
                  />
                </span>
                <span className={`${STAT_LABEL_CLASS} text-gray-400`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={`${SURFACE_CLASS} ${STUB_CLASS}`}>
        <span className={PERFORATION_CLASS} />
        <div className={`mb-3 ${SHOWCASE_HEADER_CLASS}`}>
          <span className={SECTION_LABEL_CLASS}>本命</span>
        </div>
        <div className={SHOWCASE_GRID_CLASS}>
          {Array.from({ length: SHOWCASE_MAX_ITEMS }, (_, index) => (
            <div key={index} className='min-w-0'>
              <div className={`skeleton ${SHOWCASE_COVER_CLASS}`} />
              <p className={SHOWCASE_TITLE_CLASS}>&nbsp;</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
