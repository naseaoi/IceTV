'use client';

import { useEffect, useState } from 'react';

import SkeletonText from '@/components/SkeletonText';
import { fetchMyWatchLevel } from '@/features/watch-level/api.client';
import {
  type WatchLevel,
  formatWatchHours,
  watchLevelProgress,
} from '@/lib/watch-level';

const HOUR_MS = 3_600_000;
const LINE_TEXT_CLASS = 'text-[11px] leading-4';
const TRACK_CLASS =
  'h-1 w-full overflow-hidden rounded-full bg-gray-900/[0.06] dark:bg-white/[0.08]';
// 菜单每次打开都会重新挂载；先展示上次的累计再静默刷新，只有首次打开出现占位
const knownCountedMs = new Map<string, number>();

export function WatchProgressLine({
  profileId,
  level,
}: {
  profileId: string;
  level: WatchLevel;
}) {
  const [countedMs, setCountedMs] = useState(() =>
    knownCountedMs.get(profileId),
  );

  useEffect(() => {
    let active = true;
    fetchMyWatchLevel()
      .then((data) => {
        knownCountedMs.set(profileId, data.countedMs);
        if (active) setCountedMs(data.countedMs);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [profileId]);

  if (countedMs === undefined) {
    return (
      <div aria-hidden='true' className='mt-1.5 space-y-1'>
        <div className={TRACK_CLASS} />
        <SkeletonText
          className={LINE_TEXT_CLASS}
          barClassName='h-2.5 w-28 rounded'
        />
      </div>
    );
  }

  const { next, ratio, remainingMs } = watchLevelProgress(level, countedMs);
  return (
    <div className='mt-1.5 space-y-1'>
      <div
        role='progressbar'
        aria-label='观影等级进度'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        className={TRACK_CLASS}
      >
        <div
          className='h-full rounded-full bg-brand-500 transition-[width] duration-500'
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p
        title={
          next
            ? `再看 ${formatWatchHours(remainingMs)} 小时坐进「${next.name}」`
            : undefined
        }
        className={`${LINE_TEXT_CLASS} flex justify-between gap-2 tabular-nums text-gray-500 dark:text-gray-400`}
      >
        <span className='truncate'>
          {formatWatchHours(countedMs)}
          {next && ` / ${next.minMs / HOUR_MS}`} 小时
        </span>
        {next && <span className='shrink-0'>{next.name}</span>}
      </p>
    </div>
  );
}
