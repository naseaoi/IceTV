'use client';

import { useEffect, useState } from 'react';

import {
  clearAllPlayRecords,
  getCachedPlayRecordsSnapshot,
  getPlayRecordPage,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { selectPlayRecordPage } from '@/lib/play-records';
import type { PlayRecord } from '@/lib/types';

export type ContinueWatchingItem = PlayRecord & { key: string };

const PAGE_SIZE = 24;

function toItems(records: Record<string, PlayRecord>): ContinueWatchingItem[] {
  return Object.entries(records)
    .map(([key, record]) => ({ ...record, key }))
    .sort((left, right) => right.save_time - left.save_time);
}

export function useContinueWatchingItems(initialSkeletonCount = 0) {
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialSkeletonCount > 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [skeletonCount, setSkeletonCount] = useState(initialSkeletonCount);

  useEffect(() => {
    const cachedRecords = getCachedPlayRecordsSnapshot();
    if (cachedRecords) {
      const cachedPage = selectPlayRecordPage(cachedRecords, PAGE_SIZE);
      setItems(toItems(cachedPage.items));
      setTotal(cachedPage.total);
      setNextCursor(cachedPage.nextCursor);
      setSkeletonCount(Math.min(cachedPage.total, 8));
      setLoading(false);
    }

    let cancelled = false;

    const loadInitial = async () => {
      try {
        const page = await getPlayRecordPage(PAGE_SIZE);
        if (cancelled) return;
        setItems(toItems(page.items));
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setSkeletonCount(Math.min(page.total, 8));
      } catch (error) {
        console.error('获取继续观看记录失败:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadInitial();

    const handleRecordsUpdate = (records: Record<string, PlayRecord>) => {
      const page = selectPlayRecordPage(records, PAGE_SIZE);
      setItems(toItems(page.items));
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setSkeletonCount(Math.min(page.total, 8));
      setLoading(false);
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
      cancelled = true;
      unsubscribe();
      unsubscribeRecent();
      unsubscribeStates();
    };
  }, [initialSkeletonCount]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await getPlayRecordPage(PAGE_SIZE, nextCursor);
      setItems((current) => {
        const merged = new Map(
          [...current, ...toItems(page.items)].map((item) => [item.key, item]),
        );
        return Array.from(merged.values()).sort(
          (left, right) => right.save_time - left.save_time,
        );
      });
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } finally {
      setLoadingMore(false);
    }
  };

  const clearRecords = async () => {
    await clearAllPlayRecords();
    setItems([]);
    setTotal(0);
    setNextCursor(null);
    setSkeletonCount(0);
  };

  const removeItem = (key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
    setTotal((current) => Math.max(0, current - 1));
  };

  return {
    items,
    total,
    loading,
    loadingMore,
    skeletonCount,
    hasMore: !!nextCursor,
    loadMore,
    clearRecords,
    removeItem,
  };
}
