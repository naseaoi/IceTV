'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type ContinueWatchingFilter,
  CONTINUE_WATCHING_PAGE_SIZE,
} from '@/features/continue-watching/lib/layout';
import {
  clearAllPlayRecords,
  deletePlayRecords,
  getCachedPlayRecordsSnapshot,
  getPlayRecordPage,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { writeContinueWatchingPageCount } from '@/lib/local-preferences';
import { hasPlayRecordUpdate, selectPlayRecordPage } from '@/lib/play-records';
import type { PlayRecord, PlayRecordPage } from '@/lib/types';

export type ContinueWatchingItem = PlayRecord & { key: string };

export interface ContinueWatchingCounts {
  all: number | null;
  updated: number | null;
}

function toItems(records: Record<string, PlayRecord>): ContinueWatchingItem[] {
  return Object.entries(records)
    .map(([key, record]) => ({ ...record, key }))
    .sort((left, right) => right.save_time - left.save_time);
}

function countUpdated(records: Record<string, PlayRecord>): number {
  return Object.values(records).filter(hasPlayRecordUpdate).length;
}

function fetchFirstPage(filter: ContinueWatchingFilter) {
  return filter === 'updated'
    ? getPlayRecordPage(CONTINUE_WATCHING_PAGE_SIZE, null, {
        filter: 'updated',
      })
    : getPlayRecordPage(CONTINUE_WATCHING_PAGE_SIZE);
}

export function useContinueWatchingItems({
  filter = 'all',
  initialSkeletonCount = 0,
  initialCounts,
}: {
  filter?: ContinueWatchingFilter;
  initialSkeletonCount?: number;
  initialCounts?: ContinueWatchingCounts;
} = {}) {
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<ContinueWatchingCounts>(
    initialCounts ?? { all: null, updated: null },
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [skeletonCount, setSkeletonCount] = useState(
    Math.min(initialSkeletonCount, CONTINUE_WATCHING_PAGE_SIZE),
  );
  const itemsRef = useRef(items);
  const generationRef = useRef(0);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const applyPage = useCallback(
    (page: PlayRecordPage, activeFilter: ContinueWatchingFilter) => {
      setItems(toItems(page.items));
      setNextCursor(page.nextCursor);
      setCounts((current) => ({ ...current, [activeFilter]: page.total }));
      setSkeletonCount(Math.min(page.total, CONTINUE_WATCHING_PAGE_SIZE));
      setHasLoaded(true);
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    },
    [],
  );

  // 本地快照是全量播放记录，两种筛选的计数都可以直接算出
  const applySnapshot = useCallback(
    (
      records: Record<string, PlayRecord>,
      activeFilter: ContinueWatchingFilter,
      limit: number,
    ) => {
      const page = selectPlayRecordPage(
        records,
        limit,
        null,
        activeFilter === 'updated' ? { filter: 'updated' } : undefined,
      );
      applyPage(page, activeFilter);
      setCounts({
        all: Object.keys(records).length,
        updated: countUpdated(records),
      });
    },
    [applyPage],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    const cachedRecords = getCachedPlayRecordsSnapshot();
    if (cachedRecords) {
      applySnapshot(cachedRecords, filter, CONTINUE_WATCHING_PAGE_SIZE);
    } else if (hasLoadedRef.current) {
      setRefreshing(true);
    }

    const loadInitial = async () => {
      try {
        const page = await fetchFirstPage(filter);
        if (generation !== generationRef.current) return;
        applyPage(page, filter);
      } catch (error) {
        console.error('获取继续观看记录失败:', error);
      } finally {
        if (generation === generationRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadInitial();

    const handleRecordsUpdate = (records: Record<string, PlayRecord>) => {
      applySnapshot(
        records,
        filter,
        Math.max(CONTINUE_WATCHING_PAGE_SIZE, itemsRef.current.length),
      );
    };

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      handleRecordsUpdate,
    );
    const unsubscribeRecent = subscribeToDataUpdates(
      'recentPlayRecordsUpdated',
      handleRecordsUpdate,
    );
    const unsubscribeStates = subscribeToDataUpdates(
      'playRecordStatesUpdated',
      (updates: Record<string, PlayRecord>) => {
        setItems((current) =>
          current.map((item) =>
            updates[item.key] ? { ...updates[item.key], key: item.key } : item,
          ),
        );
      },
    );

    return () => {
      unsubscribe();
      unsubscribeRecent();
      unsubscribeStates();
    };
  }, [filter, applyPage, applySnapshot]);

  // 计数 cookie 记的是全部记录的首屏条数，筛选结果不写入
  useEffect(() => {
    if (filter === 'all' && hasLoaded && !loading && !refreshing)
      writeContinueWatchingPageCount(
        Math.min(items.length, CONTINUE_WATCHING_PAGE_SIZE),
      );
  }, [filter, hasLoaded, items.length, loading, refreshing]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;

    const generation = generationRef.current;
    setLoadingMore(true);
    try {
      const page = await getPlayRecordPage(
        CONTINUE_WATCHING_PAGE_SIZE,
        nextCursor,
        filter === 'updated' ? { filter: 'updated' } : undefined,
      );
      if (generation !== generationRef.current) return;
      setItems((current) => {
        const merged = new Map(
          [...current, ...toItems(page.items)].map((item) => [item.key, item]),
        );
        return Array.from(merged.values()).sort(
          (left, right) => right.save_time - left.save_time,
        );
      });
      setNextCursor(page.nextCursor);
      setCounts((current) => ({ ...current, [filter]: page.total }));
    } catch (error) {
      console.error('加载更多继续观看记录失败:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [filter, loadingMore, nextCursor]);

  // 有本地快照时删除事件已经同步过列表与计数，这里只处理剩下的条目
  const forgetItems = useCallback((keys: Set<string>) => {
    const removed = itemsRef.current.filter((item) => keys.has(item.key));
    if (removed.length === 0) return;
    const removedUpdated = removed.filter(hasPlayRecordUpdate).length;
    setItems((current) => current.filter((item) => !keys.has(item.key)));
    setCounts((counts) => ({
      all:
        counts.all === null ? null : Math.max(0, counts.all - removed.length),
      updated:
        counts.updated === null
          ? null
          : Math.max(0, counts.updated - removedUpdated),
    }));
  }, []);

  // 全部记录都已加载且全选时一次清空，否则按 key 批量删除
  const removeItems = useCallback(
    async (keys: string[]) => {
      if (keys.length === 0) return;
      const clearsEverything =
        filter === 'all' && !nextCursor && keys.length === items.length;
      if (clearsEverything) {
        await clearAllPlayRecords();
        setItems([]);
        setNextCursor(null);
        setCounts({ all: 0, updated: 0 });
        setSkeletonCount(0);
        return;
      }
      await deletePlayRecords(keys);
      forgetItems(new Set(keys));
    },
    [filter, forgetItems, items.length, nextCursor],
  );

  // 卡片菜单已完成删除请求，这里只同步列表
  const removeItem = useCallback(
    (key: string) => forgetItems(new Set([key])),
    [forgetItems],
  );

  return {
    items,
    counts,
    loading,
    refreshing,
    loadingMore,
    skeletonCount,
    hasMore: !!nextCursor,
    loadMore,
    removeItems,
    removeItem,
  };
}
