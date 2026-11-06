'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { PLAYER_PANEL_INSET_CLASS } from '@/components/PlayerPanelTabBar';
import { DanmakuEpisodePicker } from '@/features/play/components/EpisodeSelector/DanmakuEpisodePicker';
import { MyDanmakuSection } from '@/features/play/components/EpisodeSelector/MyDanmakuSection';
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
import { getRuntimeConfig } from '@/lib/runtime-config';

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

const stepButtonClass =
  'h-7 rounded-md px-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white';

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
  const [myDanmakuToken, setMyDanmakuToken] = useState(0);
  const userDanmakuEnabled = getRuntimeConfig()?.ENABLE_USER_DANMAKU === true;

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

  const handleBindingChange = useCallback(async () => {
    await onReload?.();
    setMyDanmakuToken((token) => token + 1);
  }, [onReload]);

  const reload = async () => {
    if (!onReload || reloading) return;
    const requestId = ++reloadRequestRef.current;
    setReloading(true);
    setReloadFeedback(null);
    try {
      const result = await onReload({ refreshData: true });
      setMyDanmakuToken((token) => token + 1);
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
      className={`flex min-h-0 flex-1 flex-col gap-5 overflow-hidden pb-4 pt-4 ${PLAYER_PANEL_INSET_CLASS}`}
    >
      <div className='shrink-0 divide-y divide-gray-900/[0.06] overflow-hidden rounded-xl bg-gray-900/[0.03] dark:divide-white/[0.06] dark:bg-white/[0.04]'>
        <div className='flex min-h-12 items-center justify-between gap-3 px-3 py-2'>
          <span className='text-[13px] text-gray-700 dark:text-gray-200'>
            时间偏移
          </span>
          <div className='flex items-center gap-1'>
            {offset !== 0 && (
              <PanelActionButton
                aria-label='重置偏移'
                onClick={() => applyOffset(0)}
              >
                重置
              </PanelActionButton>
            )}
            <div className='flex items-center rounded-lg bg-gray-900/[0.05] p-0.5 dark:bg-white/[0.06]'>
              <button
                type='button'
                aria-label='提前 1 秒'
                className={stepButtonClass}
                disabled={
                  offset - OFFSET_STEP_SECONDS < DANMAKU_OFFSET_RANGE.min
                }
                onClick={() => applyOffset(offset - OFFSET_STEP_SECONDS)}
              >
                提前
              </button>
              <span
                aria-live='polite'
                className={`w-11 text-center text-xs font-semibold tabular-nums ${
                  offset === 0
                    ? 'text-gray-400 dark:text-gray-500'
                    : 'text-brand-600 dark:text-brand-400'
                }`}
              >
                {formatOffset(offset)}
              </span>
              <button
                type='button'
                aria-label='延后 1 秒'
                className={stepButtonClass}
                disabled={
                  offset + OFFSET_STEP_SECONDS > DANMAKU_OFFSET_RANGE.max
                }
                onClick={() => applyOffset(offset + OFFSET_STEP_SECONDS)}
              >
                延后
              </button>
            </div>
          </div>
        </div>
        <OptionSwitchRow
          label='弹幕热力图'
          description='进度条上方的弹幕密度曲线'
          checked={heatmapEnabled}
          onChange={toggleHeatmap}
          className='w-full !rounded-none px-3'
        />
      </div>

      {userDanmakuEnabled && (
        <MyDanmakuSection
          source={source}
          videoId={videoId}
          episodeIndex={episodeIndex}
          scopeKey={scopeKey}
          refreshToken={myDanmakuToken}
          onDeleted={() => void onReload?.({ refreshData: false })}
        />
      )}

      <section className='flex min-h-0 flex-1 flex-col gap-2'>
        <SectionTitle as='h3' label='弹幕匹配'>
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
            className={`-mt-1 text-xs ${reloadFeedback.failed ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {reloadFeedback.message}
          </p>
        )}
        <DanmakuEpisodePicker
          source={source}
          videoId={videoId}
          episodeIndex={episodeIndex}
          searchTitle={searchTitle}
          onBindingChange={() => void handleBindingChange()}
        />
      </section>
    </div>
  );
};
