'use client';

import { useEffect, useState } from 'react';

import type {
  TrackingCalendarItem,
  TrackingStripSeed,
} from '@/features/continue-watching/lib/tracking-calendar';
import { fetchTrackingCalendar } from '@/features/continue-watching/lib/tracking-calendar-client';
import { type CacheUpdateEvent, subscribeToDataUpdates } from '@/lib/db.client';
import { writeContinueWatchingTrackingCount } from '@/lib/local-preferences';
import { isAbortError } from '@/lib/user-facing-error';

// 状态 PATCH（标为已读、搁置等）在服务端写入完成后派发；playRecordsUpdated 也随乐观写入提前派发，
// 那时读回的旧数据由随后的写入完成事件纠正
const STATE_EVENTS: CacheUpdateEvent[] = [
  'playRecordsUpdated',
  'playRecordStatesUpdated',
];
// 播放记录与收藏的新增、删除先派发乐观事件再写服务端，写入结束（含失败回滚）后统一派发此事件；
// 只听乐观事件会在写入落库前读回旧数据
const LIBRARY_WRITTEN_EVENT = 'userLibraryUpdated';

// 刚完成服务端查询时复用同次渲染的数据；后退恢复、预取的旧种子重新验证
const FRESH_SEED_MS = 5_000;

function needsRevalidation(complete: boolean, fetchedAt: number): boolean {
  const age = Date.now() - fetchedAt;
  return !complete || fetchedAt <= 0 || age < 0 || age >= FRESH_SEED_MS;
}

export function useTrackingStrip(
  seed: TrackingStripSeed,
): TrackingCalendarItem[] {
  const { complete, fetchedAt } = seed;
  const [items, setItems] = useState(seed.items);
  // 以查询时间识别种子：服务端重新渲染给出新种子时以它为准，调用方每次渲染新建对象也不会反复重置
  const [appliedFetchedAt, setAppliedFetchedAt] = useState(fetchedAt);
  if (appliedFetchedAt !== fetchedAt) {
    setAppliedFetchedAt(fetchedAt);
    setItems(seed.items);
  }

  useEffect(() => {
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      fetchTrackingCalendar(current.signal)
        .then(setItems)
        .catch((error) => {
          // 追更区是辅助区块，刷新失败保留当前内容
          if (!isAbortError(error)) console.warn('追更列表刷新失败', error);
        });
    };
    if (needsRevalidation(complete, fetchedAt)) load();
    const unsubscribes = STATE_EVENTS.map((event) =>
      subscribeToDataUpdates(event, load),
    );
    window.addEventListener(LIBRARY_WRITTEN_EVENT, load);
    return () => {
      controller?.abort();
      for (const unsubscribe of unsubscribes) unsubscribe();
      window.removeEventListener(LIBRARY_WRITTEN_EVENT, load);
    };
  }, [complete, fetchedAt]);

  useEffect(() => {
    writeContinueWatchingTrackingCount(items.length);
  }, [items.length]);

  return items;
}
