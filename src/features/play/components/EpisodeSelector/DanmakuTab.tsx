'use client';

import { useCallback, useEffect, useState } from 'react';

import { DanmakuEpisodePicker } from '@/features/play/components/EpisodeSelector/DanmakuEpisodePicker';
import {
  buildDanmakuScopeKey,
  DANMAKU_OFFSET_RANGE,
  readDanmakuHeatmapEnabled,
  readDanmakuOffset,
  writeDanmakuHeatmapEnabled,
  writeDanmakuOffset,
} from '@/lib/local-preferences';

const OFFSET_STEP_SECONDS = 1;

interface DanmakuTabProps {
  source: string;
  videoId: string;
  episodeIndex: number;
  searchTitle: string;
  onReload?: () => void;
  onHeatmapChange?: (enabled: boolean) => void;
}

function formatOffset(offset: number): string {
  if (offset === 0) return '未偏移';
  return offset > 0 ? `延后 ${offset} 秒` : `提前 ${-offset} 秒`;
}

const actionButtonClass =
  'rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';

export const DanmakuTab: React.FC<DanmakuTabProps> = ({
  source,
  videoId,
  episodeIndex,
  searchTitle,
  onReload,
  onHeatmapChange,
}) => {
  const [offset, setOffset] = useState(0);
  const [heatmapEnabled, setHeatmapEnabled] = useState(true);

  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);

  useEffect(() => {
    setOffset(scopeKey ? readDanmakuOffset(scopeKey) : 0);
  }, [scopeKey]);

  useEffect(() => {
    setHeatmapEnabled(readDanmakuHeatmapEnabled());
  }, []);

  const applyOffset = useCallback(
    (next: number) => {
      if (!scopeKey) return;
      if (next < DANMAKU_OFFSET_RANGE.min || next > DANMAKU_OFFSET_RANGE.max) {
        return;
      }
      writeDanmakuOffset(scopeKey, next);
      setOffset(next);
      onReload?.();
    },
    [scopeKey, onReload],
  );

  const toggleHeatmap = useCallback(() => {
    const next = !heatmapEnabled;
    writeDanmakuHeatmapEnabled(next);
    setHeatmapEnabled(next);
    onHeatmapChange?.(next);
  }, [heatmapEnabled, onHeatmapChange]);

  if (!scopeKey) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-gray-500 dark:text-gray-400'>
        当前播放源不支持弹幕设置
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4 sm:px-6'>
      <div className='flex flex-shrink-0 flex-col gap-2'>
        <div className='flex items-center justify-between'>
          <h3 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
            弹幕偏移
          </h3>
          <span className='text-xs text-gray-500 dark:text-gray-400'>
            {formatOffset(offset)}
          </span>
        </div>
        <div className='flex gap-2'>
          <button
            type='button'
            className={`flex-1 ${actionButtonClass}`}
            disabled={offset - OFFSET_STEP_SECONDS < DANMAKU_OFFSET_RANGE.min}
            onClick={() => applyOffset(offset - OFFSET_STEP_SECONDS)}
          >
            提前 1 秒
          </button>
          <button
            type='button'
            className={`flex-1 ${actionButtonClass}`}
            disabled={offset + OFFSET_STEP_SECONDS > DANMAKU_OFFSET_RANGE.max}
            onClick={() => applyOffset(offset + OFFSET_STEP_SECONDS)}
          >
            延后 1 秒
          </button>
          <button
            type='button'
            className={actionButtonClass}
            disabled={offset === 0}
            onClick={() => applyOffset(0)}
          >
            重置
          </button>
        </div>
      </div>

      <div className='flex flex-shrink-0 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/50'>
        <div className='min-w-0'>
          <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            弹幕热力图
          </div>
          <div className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
            进度条上方的弹幕密度曲线
          </div>
        </div>
        <button
          type='button'
          role='switch'
          aria-checked={heatmapEnabled}
          aria-label='弹幕热力图'
          onClick={toggleHeatmap}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            heatmapEnabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              heatmapEnabled ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-2'>
        <h3 className='flex-shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100'>
          弹幕选集
        </h3>
        <DanmakuEpisodePicker
          source={source}
          videoId={videoId}
          episodeIndex={episodeIndex}
          searchTitle={searchTitle}
          onBindingChange={onReload}
        />
      </div>
    </div>
  );
};
