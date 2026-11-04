'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { PLAYER_PANEL_INSET_CLASS } from '@/components/PlayerPanelTabBar';
import { DanmakuEpisodePicker } from '@/features/play/components/EpisodeSelector/DanmakuEpisodePicker';
import { OptionSwitchRow } from '@/features/play/components/EpisodeSelector/OptionSwitchRow';
import { PanelActionButton } from '@/features/play/components/EpisodeSelector/PanelActionButton';
import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';
import { getDanmakuReloadFeedback } from '@/features/play/lib/danmaku/reload-feedback';
import type { DanmakuReloadHandler } from '@/features/play/lib/danmaku/types';
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
  onReload?: DanmakuReloadHandler;
  onHeatmapChange?: (enabled: boolean) => void;
}

function formatOffset(offset: number): string {
  return offset > 0 ? `+${offset}s` : `${offset}s`;
}

const segmentButtonClass =
  'flex-1 rounded-md py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white';

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
  const [reloading, setReloading] = useState(false);
  const [reloadFeedback, setReloadFeedback] = useState<ReturnType<
    typeof getDanmakuReloadFeedback
  > | null>(null);
  const reloadRequestRef = useRef(0);

  const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);

  useEffect(() => {
    setOffset(scopeKey ? readDanmakuOffset(scopeKey) : 0);
    setReloading(false);
    setReloadFeedback(null);
    return () => {
      reloadRequestRef.current += 1;
    };
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
      void onReload?.({ refreshData: false });
    },
    [scopeKey, onReload],
  );

  const toggleHeatmap = useCallback(() => {
    const next = !heatmapEnabled;
    writeDanmakuHeatmapEnabled(next);
    setHeatmapEnabled(next);
    onHeatmapChange?.(next);
  }, [heatmapEnabled, onHeatmapChange]);

  const reload = async () => {
    if (!onReload || reloading) return;
    const requestId = ++reloadRequestRef.current;
    setReloading(true);
    setReloadFeedback(null);
    try {
      const result = await onReload({ refreshData: true });
      if (reloadRequestRef.current === requestId) {
        setReloadFeedback(getDanmakuReloadFeedback(result));
      }
    } catch {
      if (reloadRequestRef.current === requestId) {
        setReloadFeedback(getDanmakuReloadFeedback({ status: 'error' }));
      }
    } finally {
      if (reloadRequestRef.current === requestId) setReloading(false);
    }
  };

  if (!scopeKey) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-gray-500 dark:text-gray-400'>
        当前播放源不支持弹幕设置
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-5 overflow-hidden pb-4 pt-3 ${PLAYER_PANEL_INSET_CLASS}`}
    >
      <section className='flex flex-shrink-0 flex-col gap-2'>
        <SectionTitle as='h3' label='弹幕偏移'>
          <PanelActionButton
            disabled={offset === 0}
            onClick={() => applyOffset(0)}
          >
            重置
          </PanelActionButton>
        </SectionTitle>
        <div className='flex items-center gap-0.5 rounded-lg bg-gray-900/[0.04] p-0.5 dark:bg-white/[0.05]'>
          <button
            type='button'
            className={segmentButtonClass}
            disabled={offset - OFFSET_STEP_SECONDS < DANMAKU_OFFSET_RANGE.min}
            onClick={() => applyOffset(offset - OFFSET_STEP_SECONDS)}
          >
            提前 1 秒
          </button>
          <span
            aria-live='polite'
            className={`w-14 shrink-0 text-center text-xs font-semibold tabular-nums ${
              offset === 0
                ? 'text-gray-400 dark:text-gray-500'
                : 'text-gray-900 dark:text-white'
            }`}
          >
            {formatOffset(offset)}
          </span>
          <button
            type='button'
            className={segmentButtonClass}
            disabled={offset + OFFSET_STEP_SECONDS > DANMAKU_OFFSET_RANGE.max}
            onClick={() => applyOffset(offset + OFFSET_STEP_SECONDS)}
          >
            延后 1 秒
          </button>
        </div>
      </section>

      <OptionSwitchRow
        label='弹幕热力图'
        description='进度条上方的弹幕密度曲线'
        checked={heatmapEnabled}
        onChange={toggleHeatmap}
        className='-mx-2 -my-1 shrink-0 px-2'
      />

      <section className='flex min-h-0 flex-1 flex-col gap-2'>
        <SectionTitle as='h3' label='弹幕选集'>
          <PanelActionButton
            aria-label='重载弹幕'
            busy={reloading}
            disabled={!onReload}
            onClick={() => void reload()}
          >
            重载
          </PanelActionButton>
        </SectionTitle>
        {reloadFeedback && (
          <p
            role={reloadFeedback.failed ? 'alert' : 'status'}
            className={`text-xs ${reloadFeedback.failed ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {reloadFeedback.message}
          </p>
        )}
        <DanmakuEpisodePicker
          source={source}
          videoId={videoId}
          episodeIndex={episodeIndex}
          searchTitle={searchTitle}
          onBindingChange={onReload}
        />
      </section>
    </div>
  );
};
