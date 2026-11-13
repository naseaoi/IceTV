'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import LoadErrorState from '@/components/LoadErrorState';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell, { useDeferredClose } from '@/components/modals/ModalShell';
import SkeletonText from '@/components/SkeletonText';
import {
  WATCH_LEVEL_ICON,
  WATCH_LEVEL_TONE_CLASS,
} from '@/components/WatchLevelBadge';
import { fetchMyWatchLevel } from '@/features/watch-level/api.client';
import {
  type WatchLevel,
  formatWatchHours,
  WATCH_LEVELS,
  watchLevelName,
  watchLevelProgress,
} from '@/lib/watch-level';
import type {
  WatchLevelEvent,
  WatchLevelResponse as MyWatchLevel,
} from '@/lib/watch-level-types';

const HOUR_MS = 3_600_000;
const ROW_CLASS = 'flex items-start gap-3 py-2.5';
const ROW_ICON_CLASS =
  'ticket-stub flex h-8 w-8 shrink-0 items-center justify-center [--stub-notch:3px]';
const ROW_TITLE_CLASS = 'text-sm font-medium leading-5';
const ROW_META_CLASS = 'mt-0.5 text-xs leading-4';
const SUMMARY_CLASS = 'rounded-2xl bg-gray-900/[0.03] p-4 dark:bg-white/[0.04]';
const SUMMARY_TITLE_CLASS = 'text-lg font-semibold';
const SUMMARY_TOTAL_CLASS = 'text-sm tabular-nums';
const SUMMARY_TRACK_CLASS =
  'mt-3 h-1.5 overflow-hidden rounded-full bg-gray-900/[0.06] dark:bg-white/[0.08]';
const SUMMARY_HINT_CLASS = 'mt-2 text-xs';

function formatDate(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function footprintText(event: WatchLevelEvent) {
  const work = `《${event.title}》`;
  return event.episodeIndex > 1
    ? `看${work}第 ${event.episodeIndex} 集时入座`
    : `看${work}时入座`;
}

function Summary({ data }: { data: MyWatchLevel }) {
  const level = data.level;
  const {
    next,
    ratio: progress,
    remainingMs,
  } = watchLevelProgress(level, data.countedMs);
  return (
    <div className={SUMMARY_CLASS}>
      <div className='flex items-baseline justify-between gap-3'>
        <p className={`${SUMMARY_TITLE_CLASS} text-gray-900 dark:text-gray-50`}>
          {watchLevelName(level)}
        </p>
        <p
          className={`${SUMMARY_TOTAL_CLASS} text-gray-500 dark:text-gray-400`}
        >
          累计 {formatWatchHours(data.countedMs)} 小时
        </p>
      </div>
      <div
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className={SUMMARY_TRACK_CLASS}
      >
        <div
          className='h-full rounded-full bg-brand-500 transition-[width] duration-500'
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className={`${SUMMARY_HINT_CLASS} text-gray-500 dark:text-gray-400`}>
        {next
          ? `再看 ${formatWatchHours(remainingMs)} 小时坐进「${next.name}」`
          : '已坐进放映室'}
      </p>
    </div>
  );
}

function LevelRow({
  level,
  currentLevel,
  event,
}: {
  level: WatchLevel;
  currentLevel: WatchLevel;
  event: WatchLevelEvent | undefined;
}) {
  const Icon = WATCH_LEVEL_ICON[level];
  const reached = level <= currentLevel;
  const minHours = WATCH_LEVELS[level - 1].minMs / HOUR_MS;
  let meta: string;
  if (event) meta = `${formatDate(event.reachedAt)} · ${footprintText(event)}`;
  else if (level === 1) meta = '入场';
  else meta = `${minHours} 小时`;
  return (
    <li
      className={ROW_CLASS}
      aria-current={level === currentLevel || undefined}
    >
      <span
        className={`${ROW_ICON_CLASS} ${
          reached
            ? WATCH_LEVEL_TONE_CLASS[level]
            : 'bg-gray-900/[0.04] text-gray-300 dark:bg-white/[0.05] dark:text-gray-600'
        }`}
      >
        <Icon aria-hidden='true' className='h-4 w-4' strokeWidth={2} />
      </span>
      <div className='min-w-0 flex-1'>
        <p
          className={`${ROW_TITLE_CLASS} ${
            reached
              ? 'text-gray-900 dark:text-gray-100'
              : 'text-gray-400 dark:text-gray-500'
          }`}
        >
          {watchLevelName(level)}
        </p>
        <p
          className={`${ROW_META_CLASS} truncate ${
            reached
              ? 'text-gray-500 dark:text-gray-400'
              : 'text-gray-400 dark:text-gray-600'
          }`}
        >
          {meta}
        </p>
      </div>
    </li>
  );
}

function PanelSkeleton() {
  return (
    <div aria-hidden='true'>
      <div className={SUMMARY_CLASS}>
        <div className='flex items-baseline justify-between gap-3'>
          <SkeletonText
            className={SUMMARY_TITLE_CLASS}
            barClassName='h-5 w-14 rounded'
          />
          <SkeletonText
            className={SUMMARY_TOTAL_CLASS}
            barClassName='h-3.5 w-20 rounded'
          />
        </div>
        <div className={SUMMARY_TRACK_CLASS} />
        <SkeletonText
          className={SUMMARY_HINT_CLASS}
          barClassName='h-3 w-36 rounded'
        />
      </div>
      <ul className='mt-3'>
        {WATCH_LEVELS.map(({ level }) => (
          <li key={level} className={ROW_CLASS}>
            <span className={`${ROW_ICON_CLASS} skeleton`} />
            <div className='min-w-0 flex-1'>
              <SkeletonText
                className={ROW_TITLE_CLASS}
                barClassName='h-3.5 w-12 rounded'
              />
              <SkeletonText
                className={ROW_META_CLASS}
                barClassName='h-3 w-40 max-w-full rounded'
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PanelBody() {
  const [data, setData] = useState<MyWatchLevel | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let active = true;
    setFailed(false);
    fetchMyWatchLevel()
      .then((result) => active && setData(result))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(load, [load]);

  if (failed) return <LoadErrorState onRetry={load} />;
  if (!data) return <PanelSkeleton />;
  const events = new Map(data.events.map((event) => [event.level, event]));
  return (
    <>
      <Summary data={data} />
      <ul className='mt-3'>
        {WATCH_LEVELS.map(({ level }) => (
          <LevelRow
            key={level}
            level={level}
            currentLevel={data.level}
            event={events.get(level)}
          />
        ))}
      </ul>
    </>
  );
}

export function WatchLevelPanel({ onClose }: { onClose: () => void }) {
  const [open, requestClose] = useDeferredClose(onClose);
  return (
    <ModalShell
      isOpen={open}
      onClose={requestClose}
      panelClassName='max-w-sm overflow-hidden'
    >
      <div className='p-5'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className={MODAL_TITLE_CLASS}>观影等级</h2>
          <button
            type='button'
            aria-label='关闭'
            onClick={requestClose}
            className={`-mr-1.5 ${MODAL_CLOSE_BUTTON_CLASS}`}
          >
            <X className='h-4 w-4' />
          </button>
        </div>
        <PanelBody />
      </div>
    </ModalShell>
  );
}
