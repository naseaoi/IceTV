'use client';

import { ListVideo, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryEmptySkeleton,
  LibraryEmptyState,
  LibraryPageFrame,
} from '@/components/LibraryPage';
import LoadErrorState from '@/components/LoadErrorState';
import { SkeletonNumber } from '@/components/SkeletonText';
import { LIST_MAX_COUNT } from '@/features/lists/lib/limits';
import { createList, fetchMyLists } from '@/features/lists/lib/lists-client';
import type { ListSummary } from '@/features/lists/types';
import { writeListCountCookie } from '@/lib/list-count-cookies';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

import { ListGrid, ListGridSkeleton } from './ListCard';
import {
  type ListFormValues,
  ListFormDialog,
  NEW_LIST_VALUES,
} from './ListFormDialog';

const SUBTITLE_NUMBER_CLASS = 'tabular-nums';

function CreateListButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className={`${LIBRARY_PILL_BUTTON_CLASS} gap-1.5 disabled:pointer-events-none disabled:opacity-40`}
    >
      <Plus aria-hidden='true' className='h-4 w-4' />
      新建片单
    </button>
  );
}

function noop() {}

export function MyListsPageSkeleton({
  skeletonCount,
}: {
  skeletonCount: number;
}) {
  if (skeletonCount === 0) {
    return (
      <LibraryPageFrame title='我的片单'>
        <LibraryEmptySkeleton />
      </LibraryPageFrame>
    );
  }
  return (
    <LibraryPageFrame
      title='我的片单'
      subtitle={
        <>
          <SkeletonNumber
            digits={String(skeletonCount).length}
            className={SUBTITLE_NUMBER_CLASS}
          />{' '}
          个片单
        </>
      }
      action={<CreateListButton disabled onClick={noop} />}
    >
      <ListGridSkeleton count={skeletonCount} />
    </LibraryPageFrame>
  );
}

export function MyListsPageClient({
  skeletonCount = 0,
}: {
  skeletonCount?: number;
}) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState<ListFormValues | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetchMyLists(undefined, controller.signal)
      .then((value) => {
        setLists(value);
        writeListCountCookie('list_count', value.length);
      })
      .catch((fetchError) => {
        if (!isAbortError(fetchError)) {
          setError(getErrorMessage(fetchError, '加载失败'));
        }
      });
    return () => controller.abort();
  }, [reloadKey]);

  const openCreate = useCallback(() => setCreating(NEW_LIST_VALUES), []);

  async function create(values: ListFormValues) {
    const created = await createList(values);
    setLists((current) => {
      const next = [created, ...(current ?? [])];
      writeListCountCookie('list_count', next.length);
      return next;
    });
    setCreating(null);
  }

  if (lists === null) {
    if (error) {
      return (
        <LibraryPageFrame title='我的片单'>
          <LoadErrorState
            message={error}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        </LibraryPageFrame>
      );
    }
    return <MyListsPageSkeleton skeletonCount={skeletonCount} />;
  }

  const canCreate = lists.length < LIST_MAX_COUNT;
  return (
    <>
      {lists.length === 0 ? (
        <LibraryPageFrame title='我的片单'>
          <LibraryEmptyState
            icon={ListVideo}
            title='还没有片单'
            action={<CreateListButton onClick={openCreate} />}
          />
        </LibraryPageFrame>
      ) : (
        <LibraryPageFrame
          title='我的片单'
          subtitle={
            <>
              <span className={SUBTITLE_NUMBER_CLASS}>{lists.length}</span>{' '}
              个片单
            </>
          }
          action={
            <CreateListButton disabled={!canCreate} onClick={openCreate} />
          }
        >
          <ListGrid lists={lists} showPrivacy />
        </LibraryPageFrame>
      )}
      <ListFormDialog
        mode='create'
        initial={creating}
        onClose={() => setCreating(null)}
        onSubmit={create}
      />
    </>
  );
}
