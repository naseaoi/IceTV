'use client';

import {
  Bell,
  BellOff,
  Check,
  Heart,
  MoreVertical,
  PlayCircleIcon,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import { useCardInteractionManager } from '@/components/CardInteractionProvider';
import CoverImage from '@/components/CoverImage';
import { buildMobileContinuePlayUrl } from '@/components/mobile-continue-card/play-url';
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
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { savePlayIntent } from '@/lib/play-intent';
import { hasPlayRecordUpdate } from '@/lib/play-records';
import { canUseNetworkPrefetch, warmupForPlayback } from '@/lib/video-prefetch';

interface MobileContinueCardProps {
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
  progress: number;
  resumeTime: number;
  query?: string;
  onDelete?: () => void;
}

export default function MobileContinueCard({
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
  progress,
  resumeTime,
  query,
  onDelete,
}: MobileContinueCardProps) {
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
      buildMobileContinuePlayUrl({ source, id, title, year, query }),
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
        });
      }

      if (canUseNetworkPrefetch()) {
        warmupForPlayback(source, id);
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

  const openActions = useCallback(async () => {
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
        {
          id: 'play',
          label: '播放',
          icon: <PlayCircleIcon size={20} />,
          onClick: handlePlay,
        },
        {
          id: 'favorite',
          label: favorited ? '取消收藏' : '收藏',
          icon: (
            <Heart
              size={20}
              className={favorited ? 'fill-red-500 text-red-500' : undefined}
            />
          ),
          onClick: async () => {
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
          },
        },
        ...(visibleHasUpdate
          ? [
              {
                id: 'mark-update-read',
                label: '标记更新已读',
                icon: <Check size={20} />,
                onClick: handleMarkUpdateRead,
              },
            ]
          : []),
        {
          id: 'tracking',
          label: visibleTrackingEnabled ? '取消追更' : '追更',
          icon: visibleTrackingEnabled ? (
            <BellOff size={20} />
          ) : (
            <Bell size={20} />
          ),
          onClick: handleToggleTracking,
        },
        {
          id: 'delete',
          label: '删除记录',
          icon: <Trash2 size={20} />,
          onClick: handleDelete,
          color: 'danger' as const,
        },
      ],
    });
  }, [
    showActionSheet,
    interactionId,
    title,
    poster,
    source,
    id,
    sourceName,
    year,
    totalEpisodes,
    query,
    handlePlay,
    handleDelete,
    handleMarkUpdateRead,
    handleToggleTracking,
    visibleHasUpdate,
    visibleTrackingEnabled,
  ]);

  const longPressProps = useLongPress({
    onLongPress: openActions,
    onClick: handlePlay,
  });

  const progressPercent = Math.min(100, Math.max(0, progress));
  const displaySourceName = sourceName?.trim() || source;

  return (
    <div
      role='link'
      data-mobile-continue-card
      tabIndex={0}
      aria-label={`继续播放 ${title}`}
      className='relative h-[120px] w-[232px] shrink-0 select-none overflow-hidden rounded-xl border border-gray-200/60 bg-white outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-gray-700/60 dark:bg-gray-800/60'
      onClick={handlePlay}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter') {
          handlePlay();
        }
      }}
      {...longPressProps}
    >
      <div className='flex h-full'>
        <div className='relative h-full w-[80px] shrink-0 overflow-hidden'>
          <CoverImage
            src={poster}
            alt={title}
            sizes='80px'
            checkClientCacheBeforeLoad
          />
        </div>
        <div className='flex min-w-0 flex-1 flex-col justify-between p-2.5 pb-3'>
          <div className='min-w-0'>
            <p className='line-clamp-2 text-[13px] font-semibold leading-snug text-gray-900 dark:text-gray-100'>
              {title}
            </p>
            <div className='mt-1 space-y-0.5 text-[11px] text-gray-500 dark:text-gray-400'>
              {visibleHasUpdate && availableEpisodes > 1 && (
                <p className='truncate font-semibold text-amber-600 dark:text-amber-400'>
                  更新至 {availableEpisodes} 集
                </p>
              )}
              {(totalEpisodes > 1 || year) && (
                <p data-mobile-continue-meta className='truncate'>
                  {totalEpisodes > 1
                    ? `第 ${currentEpisode} 集 / 共 ${totalEpisodes} 集`
                    : year}
                </p>
              )}
              <p data-mobile-continue-source className='truncate'>
                {displaySourceName}
              </p>
            </div>
          </div>
          <p className='truncate text-[11px] text-gray-400 dark:text-gray-500'>
            已观看 {Math.round(progressPercent)}%
          </p>
        </div>
        <button
          type='button'
          data-button
          aria-label='更多操作'
          className='flex h-10 w-8 shrink-0 items-start justify-center pt-2 text-gray-400 dark:text-gray-500'
          onClick={(e) => {
            e.stopPropagation();
            openActions();
          }}
        >
          <MoreVertical className='h-4 w-4' />
        </button>
      </div>
      <div className='absolute bottom-0 left-[80px] right-0 h-[3px] bg-gray-200 dark:bg-gray-700'>
        <div
          className='h-full bg-green-500'
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
