'use client';

import { History } from 'lucide-react';
import { useState } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import Spinner from '@/components/Spinner';
import {
  CONTINUE_WATCHING_GRID_CLASS,
  CONTINUE_WATCHING_GRID_ITEM_CLASS,
} from '@/features/continue-watching/lib/layout';

import { useContinueWatchingItems } from '../hooks/useContinueWatchingItems';
import { ContinueWatchingGrid } from './ContinueWatchingGrid';

function AuthenticatedContinueWatchingPage({
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
    <PageLayout
      activePath='/'
      mobileHeader={{ title: '继续观看', showBack: true }}
    >
      <div className='overflow-visible pb-2 pt-4 md:pt-8'>
        <div className={PAGE_CONTAINER_CLASS}>
          <div className='mb-6 flex items-center justify-between'>
            <h1 className='hidden items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100 sm:flex'>
              <History className='h-6 w-6 text-orange-500' />
              继续观看
            </h1>
            <div className='flex flex-1 items-center justify-between gap-4 sm:flex-none sm:justify-end'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                {loading ? (
                  <span className='skeleton block h-5 w-16 rounded' />
                ) : (
                  `${total} 部记录`
                )}
              </span>
              {(loading || items.length > 0) && (
                <button
                  className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  disabled={loading}
                  onClick={() => setShowClearConfirm(true)}
                >
                  清空
                </button>
              )}
            </div>
          </div>

          {loading && items.length === 0 ? (
            <div className={CONTINUE_WATCHING_GRID_CLASS}>
              {Array.from({ length: skeletonCount || 8 }).map((_, index) => (
                <HomePosterCardSkeleton
                  key={index}
                  className={CONTINUE_WATCHING_GRID_ITEM_CLASS}
                />
              ))}
            </div>
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
        </div>
      </div>

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
    </PageLayout>
  );
}

export function ContinueWatchingPageClient({
  initialSkeletonCount = 0,
}: {
  initialSkeletonCount?: number;
}) {
  return (
    <AuthenticatedRoute activePath='/' message='请先登录后再查看继续观看记录。'>
      <AuthenticatedContinueWatchingPage
        initialSkeletonCount={initialSkeletonCount}
      />
    </AuthenticatedRoute>
  );
}
