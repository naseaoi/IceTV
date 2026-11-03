'use client';

import { MoreVertical, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import {
  type CardActionAnchor,
  deleteRecordAction,
  favoriteAction,
  getEpisodeMeta,
  markUpdateReadAction,
  playAction,
  trackingAction,
} from '@/components/card-actions/actions';
import { useCardInteractionManager } from '@/components/CardInteractionProvider';
import { buildContinuePlayUrl } from '@/components/continue-card/play-url';
import CoverImage from '@/components/CoverImage';
import { warmupDanmakuForNavigation } from '@/features/play/lib/danmaku/navigation-warmup';
import { useLongPress } from '@/hooks/useLongPress';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  deleteFavorite,
  deletePlayRecord,
  isFavorited,
  markPlayRecordUpdateRead,
  saveFavorite,
  setPlayRecordTracking,
} from '@/lib/db.client';
import type { ResumeGroupIdentity } from '@/lib/episode-groups';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { savePlayIntent } from '@/lib/play-intent';
import { hasPlayRecordUpdate } from '@/lib/play-records';
import { formatTime } from '@/lib/player-utils';
import { canUseNetworkPrefetch, warmupForPlayback } from '@/lib/video-prefetch';

interface ContinueCardProps {
  source: string;
  id: string;
  title: string;
  poster: string;
  year?: string;
  sourceName?: string;
  currentEpisode: number;
  totalEpisodes: number;
  hasUpdate?: boolean;
  trackingEnabled?: boolean;
  availableEpisodes?: number;
  /** 播放记录的真实集索引（0-based）；分组源展示集数与真实索引不一致时使用 */
  resumeEpisodeIndex?: number;
  /** 分组源的分组身份；上游更新后据此重新对齐集索引 */
  resumeGroup?: ResumeGroupIdentity;
  progress: number;
  resumeTime: number;
  query?: string;
  onDelete?: () => void;
}

export default function ContinueCard({
  source,
  id,
  title,
  poster,
  year,
  sourceName,
  currentEpisode,
  totalEpisodes,
  hasUpdate = false,
  trackingEnabled = true,
  availableEpisodes = totalEpisodes,
  resumeEpisodeIndex,
  resumeGroup,
  progress,
  resumeTime,
  query,
  onDelete,
}: ContinueCardProps) {
  const router = useRouter();
  const interactionId = useId();
  const { showActionSheet, showConfirm } = useCardInteractionManager();
  const [visibleHasUpdate, setVisibleHasUpdate] = useState(hasUpdate);
  const [visibleTrackingEnabled, setVisibleTrackingEnabled] =
    useState(trackingEnabled);

  useEffect(() => setVisibleHasUpdate(hasUpdate), [hasUpdate]);
  useEffect(
    () => setVisibleTrackingEnabled(trackingEnabled),
    [trackingEnabled],
  );

  const handlePlay = useCallback(() => {
    const playUrl = withReturnTo(
      buildContinuePlayUrl({ source, id, title, year, query }),
      getCurrentNavigationPath(),
    );
    const authInfo = getAuthInfoFromBrowserCookie();
    if (authInfo?.username) {
      if (currentEpisode && Number.isFinite(resumeTime) && resumeTime > 0) {
        savePlayIntent({
          source,
          id,
          episodeIndex: resumeEpisodeIndex ?? Math.max(0, currentEpisode - 1),
          resumeTime,
          groupLabel: resumeGroup?.label,
          groupIndex: resumeGroup?.index,
          groupTotal: resumeGroup?.total,
        });
      }

      if (canUseNetworkPrefetch()) {
        warmupForPlayback(source, id);
        void warmupDanmakuForNavigation({
          source,
          videoId: id,
          episodeIndex: resumeEpisodeIndex ?? Math.max(0, currentEpisode - 1),
          searchTitle: title,
          searchYear: year || '',
        });
      }
    }

    router.push(playUrl);
  }, [
    router,
    source,
    id,
    title,
    year,
    query,
    currentEpisode,
    resumeEpisodeIndex,
    resumeGroup,
    resumeTime,
  ]);

  const handleDelete = useCallback(() => {
    showConfirm(interactionId, {
      title: '确认删除播放记录？',
      message: `将删除《${title}》的播放记录`,
      cancelText: '取消',
      confirmText: '确认删除',
      onConfirm: async () => {
        await deletePlayRecord(source, id);
        onDelete?.();
      },
    });
  }, [showConfirm, interactionId, title, source, id, onDelete]);

  const handleMarkUpdateRead = useCallback(async () => {
    await markPlayRecordUpdateRead(source, id);
    setVisibleHasUpdate(false);
  }, [id, source]);

  const handleToggleTracking = useCallback(async () => {
    const record = await setPlayRecordTracking(
      source,
      id,
      !visibleTrackingEnabled,
    );
    setVisibleTrackingEnabled(record.tracking_enabled !== false);
    setVisibleHasUpdate(hasPlayRecordUpdate(record));
  }, [id, source, visibleTrackingEnabled]);

  const openActions = useCallback(
    async (anchorRect?: CardActionAnchor) => {
      let favorited = false;
      try {
        favorited = await isFavorited(source, id);
      } catch {
        favorited = false;
      }

      showActionSheet(interactionId, {
        title,
        poster,
        actions: [
          playAction({
            meta: getEpisodeMeta(currentEpisode, totalEpisodes),
            onClick: handlePlay,
          }),
          favoriteAction(favorited, async () => {
            if (favorited) {
              await deleteFavorite(source, id);
              return;
            }
            await saveFavorite(source, id, {
              title,
              source_name: sourceName || '',
              year: year || '',
              cover: poster,
              total_episodes: totalEpisodes,
              save_time: Date.now(),
              search_title: query || '',
            });
          }),
          ...(visibleHasUpdate
            ? [markUpdateReadAction(handleMarkUpdateRead)]
            : []),
          trackingAction(visibleTrackingEnabled, handleToggleTracking),
          deleteRecordAction(handleDelete),
        ],
        sourceName: sourceName?.trim() || source,
        anchorRect: anchorRect ?? null,
      });
    },
    [
      showActionSheet,
      interactionId,
      title,
      poster,
      source,
      id,
      sourceName,
      year,
      currentEpisode,
      totalEpisodes,
      query,
      handlePlay,
      handleDelete,
      handleMarkUpdateRead,
      handleToggleTracking,
      visibleHasUpdate,
      visibleTrackingEnabled,
    ],
  );

  const longPressProps = useLongPress({
    onLongPress: () => void openActions(),
    onClick: handlePlay,
  });

  const progressPercent = Math.min(100, Math.max(0, progress));
  const displaySourceName = sourceName?.trim() || source;

  const showUpdate = visibleHasUpdate && availableEpisodes > 1;
  const metaText =
    totalEpisodes > 1
      ? `第 ${currentEpisode} 集 / 共 ${totalEpisodes} 集`
      : year;
  return (
    <div
      role='link'
      data-continue-card
      tabIndex={0}
      aria-label={`继续播放 ${title}`}
      className='group relative flex w-[236px] shrink-0 cursor-pointer select-none gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950 md:w-[288px]'
      onClick={handlePlay}
      onContextMenu={(event) => {
        event.preventDefault();
        void openActions({
          top: event.clientY,
          left: event.clientX,
          width: 0,
          height: 0,
        });
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter') {
          handlePlay();
        }
      }}
      {...longPressProps}
    >
      <div className='poster-rounded-clip relative aspect-[2/3] w-[76px] shrink-0 self-start overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-900/[0.06] dark:bg-gray-800 dark:ring-white/[0.06] md:w-[88px]'>
        <CoverImage
          src={poster}
          alt={title}
          sizes='(min-width: 768px) 88px, 76px'
          checkClientCacheBeforeLoad
        />
        <div className='absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100'>
          <span className='flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow-lg'>
            <Play aria-hidden='true' className='ml-0.5 h-4 w-4 fill-current' />
          </span>
        </div>
      </div>
      <div className='flex min-w-0 flex-1 flex-col py-1'>
        <p className='line-clamp-2 pr-6 text-[13px] font-semibold leading-snug text-gray-900 transition-colors duration-200 group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-300 md:text-sm'>
          {title}
        </p>
        <div className='mt-1 space-y-0.5 text-xs'>
          {/* 更新信息并入集数行，多占一行会撑高整排卡片 */}
          {showUpdate ? (
            <p
              data-continue-meta
              className='truncate text-gray-500 dark:text-gray-400'
            >
              第 {currentEpisode} 集 /{' '}
              <span className='font-medium text-amber-600 dark:text-amber-400'>
                更新至 {availableEpisodes} 集
              </span>
            </p>
          ) : (
            metaText && (
              <p
                data-continue-meta
                className='truncate text-gray-500 dark:text-gray-400'
              >
                {metaText}
              </p>
            )
          )}
          <p
            data-continue-source
            className='truncate text-gray-400 dark:text-gray-500'
          >
            {displaySourceName}
          </p>
        </div>
        <div className='mt-auto pt-2'>
          <div className='flex items-center justify-between gap-2 text-[11px] tabular-nums text-gray-400 dark:text-gray-500'>
            <span className='truncate'>
              {resumeTime > 0 ? `看到 ${formatTime(resumeTime)}` : '未开始'}
            </span>
            <span className='shrink-0'>{Math.round(progressPercent)}%</span>
          </div>
          <div className='mt-1 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10'>
            <div
              className='h-full rounded-full bg-brand-500 dark:bg-brand-400'
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>
      <button
        type='button'
        data-button
        aria-label='更多操作'
        className='absolute -right-1 top-0 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-[color,background-color,opacity] hover:bg-gray-900/[0.06] hover:text-gray-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-gray-500 dark:hover:bg-white/[0.08] dark:hover:text-gray-200 [@media(pointer:fine)]:opacity-0'
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          void openActions({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          });
        }}
      >
        <MoreVertical className='h-4 w-4' />
      </button>
    </div>
  );
}
