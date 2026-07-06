import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import { clearSearchHistory, deleteSearchHistory } from '@/lib/db.client';

interface SearchHistoryProps {
  searchHistory: string[];
  setSearchQuery: (query: string) => void;
}

export default function SearchHistory({
  searchHistory,
  setSearchQuery,
}: SearchHistoryProps) {
  const router = useRouter();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <section className='mb-12'>
      {searchHistory.length > 0 && (
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
                    setSearchQuery(item);
                    router.push(`/search?q=${encodeURIComponent(item.trim())}`);
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
      )}

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
