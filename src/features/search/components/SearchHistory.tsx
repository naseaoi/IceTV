import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import { clearSearchSnapshotCache } from '@/features/search/hooks/useSearchExecution';
import { normalizeSearchQueryInput } from '@/features/search/lib/searchQuery';
import { clearSearchHistory, deleteSearchHistory } from '@/lib/db.client';

interface SearchHistoryProps {
  searchHistory: string[];
  setSearchQuery: (query: string) => void;
  loading?: boolean;
}

export default function SearchHistory({
  searchHistory,
  setSearchQuery,
  loading = false,
}: SearchHistoryProps) {
  const router = useRouter();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <section className='mb-12'>
      {loading ? (
        <>
          <div className='mx-auto mb-4 h-7 w-24 animate-pulse rounded-md bg-gray-200/80 dark:bg-white/[0.08]' />
          <div className='flex flex-wrap justify-center gap-2'>
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className='h-9 w-20 animate-pulse rounded-full bg-gray-200/80 dark:bg-white/[0.08]'
              />
            ))}
          </div>
        </>
      ) : searchHistory.length > 0 ? (
        <>
          <h2 className='mb-4 text-center text-xl font-bold text-gray-800 dark:text-gray-200'>
            搜索历史
            <button
              onClick={() => setShowClearConfirm(true)}
              className='ml-3 text-sm text-red-500 transition-colors hover:text-red-600 dark:text-red-400 dark:hover:text-red-500'
            >
              清空
            </button>
          </h2>
          <div className='flex flex-wrap justify-center gap-2'>
            {searchHistory.map((item) => (
              <div key={item} className='group relative'>
                <button
                  onClick={() => {
                    const query = normalizeSearchQueryInput(item);
                    if (!query) return;
                    clearSearchSnapshotCache(query);
                    setSearchQuery(query);
                    router.push(`/search?q=${encodeURIComponent(query)}`);
                  }}
                  className='rounded-full bg-gray-500/10 px-4 py-2 text-sm text-gray-700 transition-colors duration-200 hover:bg-gray-300 dark:bg-gray-700/50 dark:text-gray-300 dark:hover:bg-gray-600'
                >
                  {item}
                </button>
                <button
                  aria-label='删除搜索历史'
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    deleteSearchHistory(item);
                  }}
                  className='absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-400 text-[10px] text-white opacity-0 transition-colors hover:bg-red-500 group-hover:opacity-100'
                >
                  <X className='h-3 w-3' />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <ConfirmModal
        isOpen={showClearConfirm}
        title='确认清空搜索历史？'
        message='该操作将删除所有搜索历史记录，删除后无法恢复。'
        danger
        cancelText='取消'
        confirmText='清空'
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={() => {
          clearSearchHistory();
          setShowClearConfirm(false);
        }}
      />
    </section>
  );
}
