'use client';

import { ListVideo } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ListEmptySkeleton, ListEmptyState } from '@/components/ListState';
import LoadErrorState from '@/components/LoadErrorState';
import { fetchProfileLists } from '@/features/lists/lib/lists-client';
import type { ListSummary } from '@/features/lists/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

import {
  ListGrid,
  ListGridSkeleton,
  SIDEBAR_LIST_GRID_CLASS,
} from './ListCard';

const PROFILE_LISTS_EMPTY_CLASS = 'py-5 text-center';

export function ProfileLists({
  profileId,
  isSelf,
  skeletonCount,
}: {
  profileId: string;
  isSelf: boolean;
  // 资料接口按同一可见范围给出的片单数
  skeletonCount: number;
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
  if (!lists) {
    if (skeletonCount === 0) {
      return <ListEmptySkeleton className={PROFILE_LISTS_EMPTY_CLASS} />;
    }
    return (
      <ListGridSkeleton
        count={skeletonCount}
        gridClassName={SIDEBAR_LIST_GRID_CLASS}
      />
    );
  }
  if (lists.length === 0) {
    return (
      <ListEmptyState
        icon={<ListVideo />}
        label={isSelf ? '还没有片单' : '暂无公开片单'}
        className={PROFILE_LISTS_EMPTY_CLASS}
      />
    );
  }
  return (
    <ListGrid
      lists={lists}
      showPrivacy={isSelf}
      gridClassName={SIDEBAR_LIST_GRID_CLASS}
    />
  );
}
