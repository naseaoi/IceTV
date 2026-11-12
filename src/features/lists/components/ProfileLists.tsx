'use client';

import { useEffect, useState } from 'react';

import LoadErrorState from '@/components/LoadErrorState';
import { fetchProfileLists } from '@/features/lists/lib/lists-client';
import type { ListSummary } from '@/features/lists/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

import { ListGrid, ListGridSkeleton } from './ListCard';

const DEFAULT_SKELETON_COUNT = 3;

export function ProfileLists({
  profileId,
  isSelf,
}: {
  profileId: string;
  isSelf: boolean;
}) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetchProfileLists(profileId, controller.signal)
      .then(setLists)
      .catch((fetchError) => {
        if (!isAbortError(fetchError)) {
          setError(getErrorMessage(fetchError, '加载失败'));
        }
      });
    return () => controller.abort();
  }, [profileId, reloadKey]);

  if (error && !lists) {
    return (
      <LoadErrorState
        message={error}
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    );
  }
  if (!lists) return <ListGridSkeleton count={DEFAULT_SKELETON_COUNT} />;
  if (lists.length === 0) {
    return (
      <div className='py-5 text-center text-gray-500 dark:text-gray-400'>
        {isSelf ? '还没有片单' : '暂无公开片单'}
      </div>
    );
  }
  return <ListGrid lists={lists} showPrivacy={isSelf} />;
}
