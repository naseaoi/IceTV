'use client';

import { Heart, MoreVertical, PlayCircleIcon, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useId } from 'react';

import { useCardInteractionManager } from '@/components/CardInteractionProvider';
import CoverImage from '@/components/CoverImage';
import { buildMobileContinuePlayUrl } from '@/components/mobile-continue-card/play-url';
import { useLongPress } from '@/hooks/useLongPress';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  deleteFavorite,
  deletePlayRecord,
  isFavorited,
  saveFavorite,
} from '@/lib/db.client';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { savePlayIntent } from '@/lib/play-intent';
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
  progress,
  resumeTime,
  query,
  onDelete,
}: MobileContinueCardProps) {
  const router = useRouter();
  const interactionId = useId();
  const { showActionSheet, showConfirm } = useCardInteractionManager();

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
          episodeIndex: Math.max(0, currentEpisode - 1),
          resumeTime,
        });
      }

      if (canUseNetworkPrefetch()) {
        warmupForPlayback(source, id);
      }
    }

    router.push(playUrl);
  }, [router, source, id, title, year, query, currentEpisode, resumeTime]);

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
  ]);

  const longPressProps = useLongPress({
    onLongPress: openActions,
    onClick: handlePlay,
  });

  const progressPercent = Math.min(100, Math.max(0, progress));

  return (
    <div
      role='link'
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
          <CoverImage src={poster} alt={title} sizes='80px' />
        </div>
        <div className='flex min-w-0 flex-1 flex-col justify-between p-2.5 pb-3'>
          <div className='min-w-0'>
            <p className='line-clamp-2 text-[13px] font-semibold leading-snug text-gray-900 dark:text-gray-100'>
              {title}
            </p>
            <p className='mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400'>
              {totalEpisodes > 1
                ? `第 ${currentEpisode} 集 / 共 ${totalEpisodes} 集`
                : sourceName || year || ''}
            </p>
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
