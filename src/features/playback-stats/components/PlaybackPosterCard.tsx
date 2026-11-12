'use client';

import { Check } from 'lucide-react';
import type React from 'react';
import { type ReactNode, useCallback, useEffect, useId } from 'react';

import {
  type CardActionAnchor,
  buildCardActions,
} from '@/components/card-actions/actions';
import {
  useCardInteractionManager,
  useFavoriteStatus,
} from '@/components/CardInteractionProvider';
import CoverImage from '@/components/CoverImage';
import {
  POSTER_CARD_COVER_CLASS,
  POSTER_CARD_INTERACTION_CLASS,
  POSTER_CARD_SUBTITLE_ROW_CLASS,
  POSTER_HOVER_SHADE_CLASS,
} from '@/components/poster-card-layout';
import PosterFavoriteButton from '@/components/PosterFavoriteButton';
import SourceNameBadge from '@/components/SourceNameBadge';
import {
  noSelectStyle,
  preventContextMenu,
} from '@/components/video-card/constants';
import { VideoCardTitle } from '@/components/video-card/VideoCardTitle';
import { useOpenWatchRecord } from '@/components/watch-record-context';
import { useLongPress } from '@/hooks/useLongPress';
import {
  deleteFavorite,
  generateStorageKey,
  getCachedPlayRecordsSnapshot,
  saveFavorite,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';

interface PlaybackPosterCardProps {
  title: string;
  cover: string;
  source: string;
  videoId: string;
  year?: string;
  sourceName?: string;
  subtitle: ReactNode;
  ariaLabel: string;
  // 0–100
  progress?: number;
  rank?: number;
  coverSizes?: string;
  onPlay: () => void;
  onPrefetch?: () => void;
  onDelete?: () => void | Promise<void>;
  selectable?: boolean;
  selected?: boolean;
}

// 最近观看与常看共用，悬停与操作菜单对齐收藏卡片（VideoCard）
export function PlaybackPosterCard({
  title,
  cover,
  source,
  videoId,
  year = '',
  sourceName,
  subtitle,
  ariaLabel,
  progress = 0,
  rank,
  coverSizes,
  onPlay,
  onPrefetch,
  onDelete,
  selectable = false,
  selected = false,
}: PlaybackPosterCardProps) {
  const interactionId = useId();
  const openWatchRecord = useOpenWatchRecord();
  const {
    showActionSheet,
    hideActionSheet,
    showConfirm,
    ensureFavoritesLoaded,
    getFavoriteStatus,
  } = useCardInteractionManager();
  const hasTarget = Boolean(source && videoId);
  const favorited = useFavoriteStatus(source, videoId, hasTarget);

  useEffect(
    () => () => hideActionSheet(interactionId),
    [hideActionSheet, interactionId],
  );

  const handlePrefetch = useCallback(() => {
    if (selectable) return;
    onPrefetch?.();
    if (hasTarget) void ensureFavoritesLoaded();
  }, [ensureFavoritesLoaded, hasTarget, onPrefetch, selectable]);

  const toggleFavorite = useCallback(
    async (current: boolean, notify = false) => {
      if (!hasTarget) return;
      if (current) {
        showConfirm(interactionId, {
          objectKey: `${source}+${videoId}`,
          operation: 'favorite',
          title: '确认取消收藏？',
          message: `确认取消收藏「${title}」吗？`,
          danger: true,
          cancelText: '再想想',
          confirmText: '取消收藏',
          onConfirm: async () => {
            await deleteFavorite(source, videoId);
            if (notify) showToast('已取消收藏', 'success');
          },
        });
        return;
      }
      const record =
        getCachedPlayRecordsSnapshot()?.[generateStorageKey(source, videoId)];
      await saveFavorite(source, videoId, {
        title,
        source_name: sourceName || record?.source_name || '',
        year: year || record?.year || '',
        cover: cover || record?.cover || '',
        total_episodes: record?.total_episodes || 1,
        save_time: Date.now(),
        search_title: record?.search_title || '',
      });
      if (notify) showToast('已加入收藏', 'success');
    },
    [
      cover,
      hasTarget,
      interactionId,
      showConfirm,
      source,
      sourceName,
      title,
      videoId,
      year,
    ],
  );

  const openActions = useCallback(
    async (anchorRect: CardActionAnchor | null) => {
      if (selectable) return;
      if (hasTarget) await ensureFavoritesLoaded();
      const current = hasTarget
        ? getFavoriteStatus(generateStorageKey(source, videoId))
        : false;
      const record = hasTarget
        ? getCachedPlayRecordsSnapshot()?.[generateStorageKey(source, videoId)]
        : undefined;
      showActionSheet(interactionId, {
        objectKey: `${source}+${videoId}`,
        title,
        poster: cover,
        actions: buildCardActions({
          play: { onClick: onPlay },
          favorite: hasTarget
            ? {
                favorited: current,
                onToggle: () => toggleFavorite(current, true),
              }
            : undefined,
          watchRecord:
            openWatchRecord && hasTarget
              ? () =>
                  openWatchRecord({
                    source,
                    id: videoId,
                    title,
                    year: year || record?.year || '',
                    cover: cover || record?.cover || '',
                    sourceName: sourceName || record?.source_name || '',
                    totalEpisodes: record?.total_episodes,
                    searchTitle: record?.search_title || undefined,
                  })
              : null,
          remove: onDelete
            ? () =>
                showConfirm(interactionId, {
                  objectKey: `${source}+${videoId}`,
                  title: '确认删除该记录？',
                  message: `确认删除「${title}」的观看记录吗？删除后无法恢复。`,
                  danger: true,
                  cancelText: '取消',
                  confirmText: '确认删除',
                  onConfirm: onDelete,
                })
            : undefined,
        }),
        sourceName: sourceName || undefined,
        anchorRect,
      });
    },
    [
      cover,
      ensureFavoritesLoaded,
      getFavoriteStatus,
      hasTarget,
      interactionId,
      onDelete,
      onPlay,
      openWatchRecord,
      selectable,
      showActionSheet,
      showConfirm,
      source,
      sourceName,
      title,
      toggleFavorite,
      videoId,
      year,
    ],
  );

  const longPressProps = useLongPress({
    onLongPress: () => void openActions(null),
    onClick: onPlay,
    longPressDelay: 500,
  });

  return (
    <div
      role='button'
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={selectable ? selected : undefined}
      className={`${POSTER_CARD_INTERACTION_CLASS} outline-none`}
      onClick={onPlay}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault();
          onPlay();
        }
      }}
      {...(selectable ? {} : longPressProps)}
      style={
        {
          ...noSelectStyle,
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        } as React.CSSProperties
      }
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void openActions({
          top: event.clientY,
          left: event.clientX,
          width: 0,
          height: 0,
        });
      }}
      onDragStart={(event) => event.preventDefault()}
    >
      <div
        className={`${POSTER_CARD_COVER_CLASS} poster-rounded-clip relative overflow-hidden bg-gray-200 ring-offset-2 ring-offset-gray-50 dark:bg-gray-800 dark:ring-offset-gray-950 ${
          selected ? 'ring-2 ring-brand-500' : ''
        } group-focus-visible:ring-2 group-focus-visible:ring-brand-400`}
        style={noSelectStyle}
        onContextMenu={preventContextMenu}
      >
        <CoverImage src={cover} alt={title} sizes={coverSizes} />

        {selectable ? (
          <div
            className={`absolute inset-0 transition ${
              selected ? 'bg-black/30' : 'group-hover:bg-black/10'
            }`}
          >
            <span
              className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                selected
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-white/90 bg-black/20'
              }`}
            >
              {selected && <Check className='h-3.5 w-3.5' strokeWidth={3} />}
            </span>
          </div>
        ) : (
          <>
            <div className={POSTER_HOVER_SHADE_CLASS} />
            {hasTarget && (
              <PosterFavoriteButton
                favorited={favorited}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void toggleFavorite(favorited);
                }}
              />
            )}
          </>
        )}

        {rank !== undefined ? (
          <span className='absolute left-0 top-0 flex h-6 min-w-6 items-center justify-center rounded-br-lg bg-black/70 px-1.5 text-xs font-semibold tabular-nums text-white'>
            {rank}
          </span>
        ) : (
          !selectable &&
          sourceName && (
            <div className='absolute inset-x-2 top-2 z-10 flex'>
              <SourceNameBadge sourceName={sourceName} />
            </div>
          )
        )}

        {progress > 0 && (
          <div className='absolute inset-x-0 bottom-0 h-1 bg-black/30'>
            <div
              className='h-full bg-brand-500'
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        )}
      </div>

      <VideoCardTitle title={title} />
      <p
        className={`${POSTER_CARD_SUBTITLE_ROW_CLASS} truncate text-gray-500 dark:text-gray-400`}
        style={noSelectStyle}
      >
        {subtitle}
      </p>
    </div>
  );
}
