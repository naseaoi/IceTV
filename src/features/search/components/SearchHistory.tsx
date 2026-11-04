import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import { buildSearchHref } from '@/components/SearchBox';
import { SearchHistorySkeleton } from '@/features/search/components/SearchPageSkeleton';
import { clearSearchSnapshotCache } from '@/features/search/hooks/useSearchExecution';
import {
  SEARCH_HISTORY_CHIP_SHAPE_CLASS,
  SEARCH_HISTORY_HEADER_BUTTON_SHAPE_CLASS,
  SEARCH_HISTORY_HEADER_CLASS,
  SEARCH_HISTORY_TITLE_TEXT_CLASS,
} from '@/features/search/lib/search-layout';
import { normalizeSearchQueryInput } from '@/features/search/lib/searchQuery';
import { useLongPress } from '@/hooks/useLongPress';
import { clearSearchHistory, deleteSearchHistory } from '@/lib/db.client';

interface SearchHistoryProps {
  searchHistory: string[];
  setSearchQuery: (query: string) => void;
  loading?: boolean;
}

const HEADER_BUTTON_CLASS = `${SEARCH_HISTORY_HEADER_BUTTON_SHAPE_CLASS} text-gray-500 transition-colors hover:bg-gray-900/[0.05] dark:text-gray-400 dark:hover:bg-white/[0.06]`;

function HistoryChip({
  item,
  editing,
  onSearch,
  onEnterEditing,
}: {
  item: string;
  editing: boolean;
  onSearch: (item: string) => void;
  onEnterEditing: () => void;
}) {
  const activate = () =>
    editing ? void deleteSearchHistory(item) : onSearch(item);
  // 触屏长按进入删除模式；轻触由 hook 的 onClick 接管，鼠标点击走按钮自身 onClick
  const longPressProps = useLongPress({
    onLongPress: onEnterEditing,
    onClick: activate,
  });

  return (
    <li className='group relative'>
      <button
        type='button'
        aria-label={editing ? `删除搜索历史 ${item}` : undefined}
        onClick={activate}
        onContextMenu={(event) => event.preventDefault()}
        {...longPressProps}
        className={`${SEARCH_HISTORY_CHIP_SHAPE_CLASS} flex max-w-[16rem] select-none items-center gap-1.5 transition-colors [-webkit-touch-callout:none] ${
          editing
            ? 'bg-gray-900/[0.05] pr-3 text-gray-700 ring-1 ring-inset ring-gray-900/10 dark:bg-white/[0.06] dark:text-gray-300 dark:ring-white/10'
            : 'bg-gray-900/[0.05] text-gray-700 hover:bg-gray-900/[0.09] hover:text-gray-900 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white'
        }`}
      >
        <span className='truncate'>{item}</span>
        {editing && (
          <X aria-hidden='true' className='h-3.5 w-3.5 shrink-0 opacity-60' />
        )}
      </button>
      {!editing && (
        <button
          type='button'
          aria-label={`删除搜索历史 ${item}`}
          onClick={() => void deleteSearchHistory(item)}
          className='absolute -right-1 -top-1 hidden h-[18px] w-[18px] items-center justify-center rounded-full bg-gray-500 text-white opacity-0 transition-opacity hover:bg-red-500 focus-visible:opacity-100 group-hover:opacity-100 dark:bg-gray-600 md:flex'
        >
          <X className='h-3 w-3' />
        </button>
      )}
    </li>
  );
}

export default function SearchHistory({
  searchHistory,
  setSearchQuery,
  loading = false,
}: SearchHistoryProps) {
  const router = useRouter();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (searchHistory.length === 0) setEditing(false);
  }, [searchHistory.length]);

  if (loading) return <SearchHistorySkeleton />;
  if (searchHistory.length === 0) return null;

  const search = (item: string) => {
    const query = normalizeSearchQueryInput(item);
    if (!query) return;
    clearSearchSnapshotCache(query);
    setSearchQuery(query);
    router.push(buildSearchHref(query));
  };

  return (
    <section aria-labelledby='search-history-title'>
      <div className={SEARCH_HISTORY_HEADER_CLASS}>
        <h2
          id='search-history-title'
          className={`${SEARCH_HISTORY_TITLE_TEXT_CLASS} font-semibold text-gray-900 dark:text-gray-100`}
        >
          搜索历史
        </h2>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={() => setShowClearConfirm(true)}
            className={`${HEADER_BUTTON_CLASS} hover:text-red-600 dark:hover:text-red-400`}
          >
            清空
          </button>
          {editing && (
            <button
              type='button'
              onClick={() => setEditing(false)}
              className={`${HEADER_BUTTON_CLASS} font-medium text-brand-600 dark:text-brand-300`}
            >
              完成
            </button>
          )}
        </div>
      </div>
      <ul className='flex flex-wrap gap-2'>
        {searchHistory.map((item) => (
          <HistoryChip
            key={item}
            item={item}
            editing={editing}
            onSearch={search}
            onEnterEditing={() => setEditing(true)}
          />
        ))}
      </ul>

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
