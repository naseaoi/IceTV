'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import type { BangumiCalendarData } from '@/features/bangumi/lib/bangumi.client';
import {
  type CustomCategory,
  type FeedQuery,
  appendUniqueItems,
  fetchFeedPage,
  getBangumiWeekdayItems,
  getDefaultFeedQuery,
  getFeedQueryKey,
  isCalendarQuery,
  uniqueItems,
  withPrimary,
} from '@/features/douban/lib/feed-query';
import {
  type FeedEntry,
  readFeedEntry,
  readLastFeedQuery,
  rememberFeedQuery,
  writeFeedEntry,
} from '@/features/douban/lib/feed-store';
import { getPageScrollTop, scrollPageTo } from '@/hooks/usePageScroll';
import type { DoubanItem } from '@/lib/types';

export type { CustomCategory } from '@/features/douban/lib/feed-query';

// loading 请求第 0 页并替换列表，loadingMore 请求第 pageCount 页并追加
type FeedStatus = 'loading' | 'loadingMore' | 'idle' | 'failed';

interface FeedState extends FeedEntry {
  query: FeedQuery;
  key: string;
  customCategories: CustomCategory[];
  status: FeedStatus;
}

type FeedAction =
  | { type: 'reset'; state: FeedState }
  | {
      type: 'pageLoaded';
      key: string;
      page: number;
      items: DoubanItem[];
      hasMore: boolean;
      calendarStale: boolean;
      loadedAt: number;
    }
  | { type: 'pageFailed'; key: string; page: number }
  | { type: 'loadMore' }
  | { type: 'retry' };

function getRequestedPage(state: FeedState): number | null {
  if (state.status === 'loading') return 0;
  if (state.status === 'loadingMore') return state.pageCount;
  return null;
}

function createFeedState(
  query: FeedQuery,
  customCategories: CustomCategory[],
  entry: FeedEntry | null,
): FeedState {
  const base = { query, key: getFeedQueryKey(query), customCategories };
  if (entry) {
    return { ...base, ...entry, status: 'idle' };
  }
  return {
    ...base,
    items: [],
    pageCount: 0,
    hasMore: true,
    preview: false,
    calendarStale: false,
    loadedAt: 0,
    status: 'loading',
  };
}

function createInitialFeedState(
  type: string,
  customCategories: CustomCategory[],
): FeedState {
  const query =
    readLastFeedQuery(type) ?? getDefaultFeedQuery(type, customCategories);
  return createFeedState(query, customCategories, readFeedEntry(query));
}

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'reset':
      return action.state;
    case 'pageLoaded': {
      // 只接受当前查询正在等的那一页，切换后晚到的响应自然作废
      if (action.key !== state.key || action.page !== getRequestedPage(state)) {
        return state;
      }
      const firstPage = action.page === 0;
      return {
        ...state,
        items: firstPage
          ? uniqueItems(action.items)
          : appendUniqueItems(state.items, action.items),
        pageCount: action.page + 1,
        hasMore: action.hasMore,
        preview: false,
        calendarStale: action.calendarStale,
        loadedAt: firstPage ? action.loadedAt : state.loadedAt,
        status: 'idle',
      };
    }
    case 'pageFailed':
      if (action.key !== state.key || action.page !== getRequestedPage(state)) {
        return state;
      }
      return {
        ...state,
        hasMore: action.page === 0 ? false : state.hasMore,
        status: 'failed',
      };
    case 'loadMore':
      if (state.status !== 'idle' || !state.hasMore || state.calendarStale) {
        return state;
      }
      return { ...state, status: 'loadingMore' };
    case 'retry':
      if (state.status !== 'failed' && !state.calendarStale) {
        return state;
      }
      return state.pageCount === 0 || state.calendarStale
        ? { ...state, hasMore: true, status: 'loading' }
        : { ...state, status: 'loadingMore' };
  }
}

function isSameFilters(a: Record<string, string>, b: Record<string, string>) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  );
}

export function useDoubanFeed(type: string) {
  const customCategories = useRuntimeConfig().CUSTOM_CATEGORIES;
  const [state, dispatch] = useReducer(feedReducer, undefined, () =>
    createInitialFeedState(type, customCategories),
  );
  // 分类来自 URL，自定义分类可能在挂载后才到；在同一次渲染内整体换成新查询，旧页码与列表不会带进新分类
  if (
    state.query.type !== type ||
    (type === 'custom' && state.customCategories !== customCategories)
  ) {
    dispatch({
      type: 'reset',
      state: createInitialFeedState(type, customCategories),
    });
  }

  const calendarRef = useRef<{
    data: BangumiCalendarData[];
    stale: boolean;
  } | null>(null);

  const { key, query, preview } = state;
  const requestedPage = getRequestedPage(state);

  useEffect(() => {
    if (requestedPage === null) return;

    let cancelled = false;
    const load = async () => {
      try {
        // 首页预填的第一页来自首页自己的缓存；排名变动后升入第一页的条目既不在预填页也不在续页，补取一次分类自己的第一页
        const [leading, page] = await Promise.all([
          preview && requestedPage === 1
            ? fetchFeedPage(query, 0, customCategories).catch(() => null)
            : null,
          fetchFeedPage(query, requestedPage, customCategories),
        ]);
        if (cancelled) return;
        if (page.calendar) {
          calendarRef.current = page.calendar;
        }
        dispatch({
          type: 'pageLoaded',
          key,
          page: requestedPage,
          items: leading ? [...leading.items, ...page.items] : page.items,
          hasMore: page.hasMore,
          calendarStale: page.calendar?.stale ?? false,
          loadedAt: Date.now(),
        });
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        dispatch({ type: 'pageFailed', key, page: requestedPage });
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [customCategories, key, preview, query, requestedPage]);

  const { items, pageCount, hasMore, calendarStale, loadedAt, status } = state;

  useEffect(() => {
    if (status !== 'idle' || pageCount === 0) return;
    writeFeedEntry(query, {
      items,
      pageCount,
      hasMore,
      preview,
      calendarStale,
      loadedAt,
    });
    rememberFeedQuery(query);
  }, [
    calendarStale,
    hasMore,
    items,
    loadedAt,
    pageCount,
    preview,
    query,
    status,
  ]);

  const applyQuery = useCallback(
    (next: FeedQuery) => {
      let entry = readFeedEntry(next);
      const calendar = calendarRef.current;
      // 日历一次取整周，切换星期直接从已有数据里取，不重新请求
      if (!entry && calendar && isCalendarQuery(next)) {
        const weekdayItems = getBangumiWeekdayItems(
          calendar.data,
          next.weekday,
        );
        if (weekdayItems) {
          entry = {
            items: weekdayItems,
            pageCount: 1,
            hasMore: false,
            preview: false,
            calendarStale: calendar.stale,
            loadedAt: Date.now(),
          };
        }
      }
      dispatch({
        type: 'reset',
        state: createFeedState(next, customCategories, entry),
      });
      // 换的是一批不同的内容，停在原滚动位置只会看到列表中段或空白
      if (getPageScrollTop() > 0) {
        scrollPageTo(0);
      }
    },
    [customCategories],
  );

  const handlePrimaryChange = useCallback(
    (value: string) => {
      if (value === query.primary) return;
      applyQuery(withPrimary(query, value, customCategories));
    },
    [applyQuery, customCategories, query],
  );

  const handleSecondaryChange = useCallback(
    (value: string) => {
      if (value === query.secondary) return;
      applyQuery({ ...query, secondary: value });
    },
    [applyQuery, query],
  );

  const handleMultiLevelChange = useCallback(
    (values: Record<string, string>) => {
      if (isSameFilters(values, query.filters)) return;
      applyQuery({ ...query, filters: values });
    },
    [applyQuery, query],
  );

  const handleWeekdayChange = useCallback(
    (weekday: string) => {
      if (weekday === query.weekday) return;
      applyQuery({ ...query, weekday });
    },
    [applyQuery, query],
  );

  const loadNextPage = useCallback(() => {
    dispatch({ type: 'loadMore' });
  }, []);

  const retryLoad = useCallback(() => {
    dispatch({ type: 'retry' });
  }, []);

  return {
    doubanData: items,
    loading: status === 'loading',
    isLoadingMore: status === 'loadingMore',
    loadFailed: status === 'failed',
    hasMore,
    calendarStale,
    primarySelection: query.primary,
    secondarySelection: query.secondary,
    multiLevelValues: query.filters,
    selectedWeekday: query.weekday,
    customCategories,
    handlePrimaryChange,
    handleSecondaryChange,
    handleMultiLevelChange,
    handleWeekdayChange,
    loadNextPage,
    retryLoad,
  };
}
