'use client';

import { Check, MoreVertical, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import {
  type CardActionAnchor,
  buildCardActions,
} from '@/components/card-actions/actions';
import { useCardInteractionManager } from '@/components/CardInteractionProvider';
import {
  CONTINUE_CARD_BODY_CLASS,
  CONTINUE_CARD_CLASS,
  CONTINUE_CARD_COVER_CLASS,
  CONTINUE_CARD_COVER_SIZES,
  CONTINUE_CARD_FLUID_CLASS,
  CONTINUE_CARD_FOOTER_CLASS,
  CONTINUE_CARD_META_CLASS,
  CONTINUE_CARD_PROGRESS_BAR_CLASS,
  CONTINUE_CARD_PROGRESS_TEXT_CLASS,
  CONTINUE_CARD_TITLE_TEXT_CLASS,
} from '@/components/continue-card/layout';
import { buildContinuePlayUrl } from '@/components/continue-card/play-url';
import CoverImage from '@/components/CoverImage';
import { useOpenListPicker } from '@/components/list-picker-context';
import { useOpenWatchRecord } from '@/components/watch-record-context';
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
import { hasPlayRecordUpdate, isTrackingEnabled } from '@/lib/play-records';
import { formatTime } from '@/lib/player-utils';
import { showToast } from '@/lib/toast';
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
  /** 铺满网格格子，横排滚动时保持固定宽度 */
  fluid?: boolean;
  /** 批量编辑：点击切换选中，不播放也不弹菜单 */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
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
  fluid = false,
  selectable = false,
  selected = false,
  onSelect,
}: ContinueCardProps) {
  const router = useRouter();
  const interactionId = useId();
  const openWatchRecord = useOpenWatchRecord();
  const openListPicker = useOpenListPicker();
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
      objectKey: `${source}+${id}`,
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
    setVisibleTrackingEnabled(isTrackingEnabled(record));
    setVisibleHasUpdate(hasPlayRecordUpdate(record));
    showToast(
      isTrackingEnabled(record) ? '已开启追更' : '已取消追更',
      'success',
    );
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
        objectKey: `${source}+${id}`,
        title,
        poster,
        actions: buildCardActions({
          play: { onClick: handlePlay },
          favorite: {
            favorited,
            onToggle: async () => {
              if (favorited) {
                await deleteFavorite(source, id);
                showToast('已取消收藏', 'success');
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
              showToast('已加入收藏', 'success');
            },
          },
          addToList: openListPicker
            ? () =>
                openListPicker({
                  source,
                  id,
                  title,
                  year,
                  cover: poster,
                  searchTitle: query || undefined,
                })
            : null,
          watchRecord: openWatchRecord
            ? () =>
                openWatchRecord({
                  source,
                  id,
                  title,
                  year,
                  cover: poster,
                  sourceName: sourceName || '',
                  totalEpisodes,
                  searchTitle: query || undefined,
                })
            : null,
          updates: {
            hasUpdate: visibleHasUpdate,
            onMarkRead: handleMarkUpdateRead,
            tracking: visibleTrackingEnabled,
            onToggleTracking: handleToggleTracking,
          },
          remove: handleDelete,
        }),
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
      totalEpisodes,
      query,
      handlePlay,
      handleDelete,
      handleMarkUpdateRead,
      handleToggleTracking,
      openListPicker,
      openWatchRecord,
      visibleHasUpdate,
      visibleTrackingEnabled,
    ],
  );

  const longPressProps = useLongPress({
    onLongPress: () => void openActions(),
    onClick: handlePlay,
  });
  const handleActivate = selectable ? () => onSelect?.() : handlePlay;

  const progressPercent = Math.min(100, Math.max(0, progress));
  const displaySourceName = sourceName?.trim() || source;

  const showUpdate = visibleHasUpdate && availableEpisodes > 1;
  const metaText =
    totalEpisodes > 1
      ? `第 ${currentEpisode} 集 / 共 ${totalEpisodes} 集`
      : year;
  return (
    <div
      role={selectable ? 'button' : 'link'}
      data-continue-card
      tabIndex={0}
      aria-label={selectable ? `选择 ${title}` : `继续播放 ${title}`}
      aria-pressed={selectable ? selected : undefined}
      className={`${fluid ? CONTINUE_CARD_FLUID_CLASS : CONTINUE_CARD_CLASS} group relative cursor-pointer select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950`}
      onClick={handleActivate}
      onContextMenu={(event) => {
        event.preventDefault();
        if (selectable) return;
        void openActions({
          top: event.clientY,
          left: event.clientX,
          width: 0,
          height: 0,
        });
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || (selectable && event.key === ' ')) {
          event.preventDefault();
          handleActivate();
        }
      }}
      {...(selectable ? {} : longPressProps)}
    >
      <div
        className={`${CONTINUE_CARD_COVER_CLASS} poster-rounded-clip relative overflow-hidden bg-gray-100 ring-gray-900/[0.06] dark:bg-gray-800 dark:ring-white/[0.06] ${
          selected ? 'ring-2 ring-brand-500 dark:ring-brand-400' : 'ring-1'
        }`}
      >
        <CoverImage
          src={poster}
          alt={title}
          sizes={CONTINUE_CARD_COVER_SIZES}
          checkClientCacheBeforeLoad
        />
        {/* 两种浮层用不同 key 各自挂载，复用同一节点会在切换时互相过渡出黑屏与播放按钮 */}
        {selectable ? (
          <div
            key='select'
            className={`absolute inset-0 transition ${
              selected ? 'bg-black/30' : 'group-hover:bg-black/10'
            }`}
          >
            <span
              className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 transition ${
                selected
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-white/90 bg-black/20'
              }`}
            >
              {selected && <Check className='h-3 w-3' strokeWidth={3} />}
            </span>
          </div>
        ) : (
          <div
            key='play'
            className='absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100'
          >
            <span className='flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow-lg'>
              <Play
                aria-hidden='true'
                className='ml-0.5 h-4 w-4 fill-current'
              />
            </span>
          </div>
        )}
      </div>
      <div className={CONTINUE_CARD_BODY_CLASS}>
        <p
          className={`${CONTINUE_CARD_TITLE_TEXT_CLASS} line-clamp-2 pr-6 font-semibold text-gray-900 transition-colors duration-200 group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-300`}
        >
          {title}
        </p>
        <div className={CONTINUE_CARD_META_CLASS}>
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
        <div className={CONTINUE_CARD_FOOTER_CLASS}>
          <div
            className={`${CONTINUE_CARD_PROGRESS_TEXT_CLASS} flex items-center justify-between gap-2 tabular-nums text-gray-400 dark:text-gray-500`}
          >
            <span className='truncate'>
              {resumeTime > 0 ? `看到 ${formatTime(resumeTime)}` : '未开始'}
            </span>
            <span className='shrink-0'>{Math.round(progressPercent)}%</span>
          </div>
          <div
            className={`${CONTINUE_CARD_PROGRESS_BAR_CLASS} overflow-hidden bg-gray-200 dark:bg-white/10`}
          >
            <div
              className='h-full rounded-full bg-brand-500 dark:bg-brand-400'
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>
      {!selectable && (
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
      )}
    </div>
  );
}
