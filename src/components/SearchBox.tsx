'use client';

import { History, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useRef, useState } from 'react';

import { useSearchHistory } from '@/features/search/hooks/useSearchHistory';
import { normalizeSearchQueryInput } from '@/features/search/lib/searchQuery';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import { deleteSearchHistory } from '@/lib/db.client';

import SearchSuggestions from './SearchSuggestions';

export function buildSearchHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

const HISTORY_DROPDOWN_LIMIT = 8;

// 页面搜索框外形，搜索页骨架共用
export const SEARCH_BOX_PAGE_SHAPE_CLASS = 'h-11 rounded-full';

const VARIANT_CLASS = {
  nav: {
    icon: 'left-3 h-4 w-4',
    input:
      'h-9 rounded-full bg-gray-900/[0.06] pl-9 pr-8 text-sm focus:bg-gray-900/[0.09] focus:ring-1 focus:ring-brand-500/40 dark:bg-white/[0.07] dark:focus:bg-white/[0.11] dark:focus:ring-brand-400/40',
    clear: 'right-2 h-5 w-5',
  },
  page: {
    icon: 'left-4 h-[18px] w-[18px]',
    input: `${SEARCH_BOX_PAGE_SHAPE_CLASS} bg-white pl-11 pr-11 text-base sm:text-[15px] ring-1 ring-gray-900/[0.08] focus:ring-2 focus:ring-brand-500/40 dark:bg-white/[0.06] dark:ring-white/10 dark:focus:ring-brand-400/40`,
    clear: 'right-3 h-6 w-6',
  },
} as const;

function SearchHistoryDropdown({
  history,
  onSelect,
}: {
  history: string[];
  onSelect: (query: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? history : history.slice(0, HISTORY_DROPDOWN_LIMIT);
  const hiddenCount = history.length - visible.length;
  const containerRef = useListLayoutMotion<HTMLUListElement>(visible);

  return (
    <div
      aria-label='搜索历史'
      className='absolute left-0 right-0 top-full z-[600] mt-1.5 overflow-hidden rounded-xl bg-white p-1 shadow-2xl shadow-black/10 ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/50 dark:ring-white/[0.08]'
      // 阻止输入框失焦，点击条目或删除时下拉保持打开
      onMouseDown={(event) => event.preventDefault()}
    >
      <ul
        ref={containerRef}
        className={`relative ${expanded ? 'max-h-80 overflow-y-auto' : ''}`}
      >
        {visible.map((item) => (
          <li
            key={item}
            data-list-motion-key={item}
            className='group flex items-center'
          >
            <button
              type='button'
              onClick={() => onSelect(item)}
              className='flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-900/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.06]'
            >
              <History
                aria-hidden='true'
                className='h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500'
              />
              <span className='truncate'>{item}</span>
            </button>
            <button
              type='button'
              aria-label={`删除搜索历史 ${item}`}
              onClick={() => void deleteSearchHistory(item).catch(() => {})}
              className='ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-700 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'
            >
              <X className='h-3.5 w-3.5' />
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type='button'
          onClick={() => setExpanded(true)}
          className='mt-0.5 w-full rounded-lg border-t border-gray-100 px-3 py-2 text-center text-[13px] text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-800 dark:border-white/[0.06] dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100'
        >
          查看全部 {history.length} 条
        </button>
      )}
    </div>
  );
}

interface SearchBoxProps {
  value: string;
  onValueChange: (value: string) => void;
  variant: 'nav' | 'page';
  inputId?: string;
  autoFocus?: boolean;
  // 页面本身已展示历史时关闭，避免下拉重复
  showHistory?: boolean;
  // 未传时清除按钮只清空输入
  onClear?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
  inputClassName?: string;
}

export default function SearchBox({
  value,
  onValueChange,
  variant,
  inputId,
  autoFocus,
  showHistory = true,
  onClear,
  onFocus,
  onBlur,
  className = '',
  inputClassName = '',
}: SearchBoxProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [historyDismissed, setHistoryDismissed] = useState(false);
  // 首次聚焦才读取历史，顶栏挂在每个页面上
  const [historyRequested, setHistoryRequested] = useState(false);
  const { history } = useSearchHistory(showHistory && historyRequested);
  const styles = VARIANT_CLASS[variant];

  const historyOpen =
    showHistory &&
    focused &&
    !historyDismissed &&
    !value.trim() &&
    history.length > 0;

  const submitQuery = useCallback(
    (raw: string) => {
      const query = normalizeSearchQueryInput(raw);
      if (!query) return;
      onValueChange(query);
      setShowSuggestions(false);
      // 收起移动端键盘与下拉
      inputRef.current?.blur();
      router.push(buildSearchHref(query));
    },
    [onValueChange, router],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuery(value);
  };

  const closeSuggestions = useCallback(() => setShowSuggestions(false), []);
  const submitCurrent = useCallback(
    () => submitQuery(value),
    [submitQuery, value],
  );

  return (
    <form onSubmit={handleSubmit} role='search' className={className}>
      <div className='relative flex items-center'>
        <Search
          aria-hidden='true'
          className={`pointer-events-none absolute text-gray-400 dark:text-gray-500 ${styles.icon}`}
        />
        <input
          ref={inputRef}
          id={inputId}
          type='search'
          value={value}
          autoFocus={autoFocus}
          autoComplete='off'
          enterKeyHint='search'
          placeholder='搜索影片'
          aria-label='搜索影片'
          onChange={(event) => {
            onValueChange(event.target.value);
            setShowSuggestions(Boolean(event.target.value.trim()));
            setHistoryDismissed(false);
          }}
          onFocus={() => {
            onFocus?.();
            setFocused(true);
            setHistoryDismissed(false);
            setHistoryRequested(true);
            if (value.trim()) setShowSuggestions(true);
          }}
          onBlur={() => {
            onBlur?.();
            setFocused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setHistoryDismissed(true);
              setShowSuggestions(false);
            }
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          className={`w-full border-0 py-0 text-gray-900 outline-none transition-[background-color,box-shadow] duration-300 placeholder:text-gray-400 focus:ring-0 dark:text-gray-100 dark:placeholder:text-gray-500 [&::-webkit-search-cancel-button]:hidden ${styles.input} ${inputClassName}`}
        />
        {value && (
          <button
            type='button'
            aria-label='清除搜索内容'
            onClick={() => {
              setShowSuggestions(false);
              if (onClear) {
                onClear();
              } else {
                onValueChange('');
              }
              inputRef.current?.focus();
            }}
            className={`absolute flex items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-900/[0.06] hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/10 dark:hover:text-gray-300 ${styles.clear}`}
          >
            <X className='h-3.5 w-3.5' />
          </button>
        )}

        {historyOpen && (
          <SearchHistoryDropdown history={history} onSelect={submitQuery} />
        )}

        <SearchSuggestions
          query={value}
          isVisible={showSuggestions}
          isComposing={isComposing}
          onSelect={submitQuery}
          onClose={closeSuggestions}
          onEnterKey={submitCurrent}
        />
      </div>
    </form>
  );
}
