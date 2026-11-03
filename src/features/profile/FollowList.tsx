'use client';

import { LoaderCircle, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import ModalShell from '@/components/modals/ModalShell';
import ProfileAvatar from '@/components/ProfileAvatar';
import { useProfilePage } from '@/features/profile/hooks/useProfilePage';
import { getUserFollows } from '@/lib/profile.client';

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
        <LoaderCircle
          aria-label='加载中'
          className='mx-auto h-5 w-5 animate-spin text-gray-400'
        />
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
  profileId,
  type,
  onClose,
}: {
  profileId: string;
  type: 'followers' | 'following';
  onClose: () => void;
}) {
  const load = useCallback(
    (cursor: string | null) => getUserFollows(profileId, type, cursor),
    [profileId, type],
  );
  const page = useProfilePage(load);
  return (
    <ModalShell isOpen onClose={onClose} panelClassName='max-w-md p-5'>
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
              className='flex items-center gap-3 rounded-xl p-3 hover:bg-gray-100 dark:hover:bg-white/5'
            >
              <ProfileAvatar {...item} />
              <span>{item.nickname ?? '未设置昵称'}</span>
            </Link>
          ))}
          {!page.loading && !page.error && page.items.length === 0 && (
            <p className='py-8 text-center text-sm text-gray-500'>暂无用户</p>
          )}
          <PageFooter {...page} />
        </div>
      </div>
    </ModalShell>
  );
}
