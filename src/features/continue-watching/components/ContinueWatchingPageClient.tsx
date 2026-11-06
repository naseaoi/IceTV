'use client';

import { useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import Spinner from '@/components/Spinner';
import { useContinueWatchingItems } from '@/features/continue-watching/hooks/useContinueWatchingItems';

import { ContinueWatchingGrid } from './ContinueWatchingGrid';
import {
  ContinueWatchingGridSkeleton,
  ContinueWatchingPageFrame,
} from './ContinueWatchingPageFrame';

export function ContinueWatchingPageClient({
  initialSkeletonCount = 0,
}: {
  initialSkeletonCount?: number;
}) {
  const {
    items,
    total,
    loading,
    loadingMore,
    skeletonCount,
    hasMore,
    loadMore,
    clearRecords,
    removeItem,
  } = useContinueWatchingItems(initialSkeletonCount);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <ContinueWatchingPageFrame
      total={loading ? null : total}
      action={
        (loading || items.length > 0) && (
          <button
            className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            disabled={loading}
            onClick={() => setShowClearConfirm(true)}
          >
            清空
          </button>
        )
      }
    >
      {loading && items.length === 0 ? (
        <ContinueWatchingGridSkeleton count={skeletonCount} />
      ) : (
        <ContinueWatchingGrid items={items} onDelete={removeItem} />
      )}

      {hasMore && (
        <div className='mt-8 flex justify-center'>
          <button
            type='button'
            className='inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore && <Spinner className='h-4 w-4' />}
            {loadingMore ? '加载中...' : '加载更多'}
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={showClearConfirm}
        title='确认清空继续观看记录？'
        message='该操作会删除所有继续观看记录，删除后无法恢复。'
        danger
        cancelText='再想想'
        confirmText='确认清空'
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={async () => {
          await clearRecords();
          setShowClearConfirm(false);
        }}
      />
    </ContinueWatchingPageFrame>
  );
}
