'use client';

import { useRouter } from 'next/navigation';
import type React from 'react';
import { useCallback, useEffect, useId } from 'react';

import {
  type CardActionAnchor,
  buildCardActions,
} from '@/components/card-actions/actions';
import { useCardInteractionManager } from '@/components/CardInteractionProvider';
import { useOpenListPicker } from '@/components/list-picker-context';
import { noSelectStyle } from '@/components/video-card/constants';
import { useOpenWatchRecord } from '@/components/watch-record-context';
import { useLongPress } from '@/hooks/useLongPress';
import { usePlaybackIntentPrefetch } from '@/hooks/usePlaybackIntentPrefetch';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import {
  deleteFavorite,
  generateStorageKey,
  saveFavorite,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';

// source / id 为空时作品无法定位，菜单只保留播放
export interface MediaCardMenuTarget {
  source?: string;
  id?: string;
  title: string;
  year?: string;
  cover: string;
  searchTitle?: string;
  sourceName?: string;
  totalEpisodes?: number;
}

const CATALOG_SOURCE_NAMES: Record<string, string> = {
  douban: '豆瓣',
  bangumi: 'Bangumi',
};

function normalizeYear(year?: string) {
  return year && year !== 'unknown' ? year : '';
}

/**
 * 给跳转播放页的封面链接挂上与海报卡片一致的操作菜单：
 * 桌面右键在光标处展开，触屏长按展开底部面板，短按照常跳转。
 * 返回值整体展开到 `<Link>` 上。
 */
export function useMediaCardMenu({
  target,
  href,
  onRemoveFromList,
}: {
  target: MediaCardMenuTarget;
  href: string;
  onRemoveFromList?: () => Promise<void>;
}) {
  const router = useRouter();
  const interactionId = useId();
  const openListPicker = useOpenListPicker();
  const openWatchRecord = useOpenWatchRecord();
  const {
    showActionSheet,
    hideActionSheet,
    showConfirm,
    ensureFavoritesLoaded,
    getFavoriteStatus,
  } = useCardInteractionManager();
  const source = target.source ?? '';
  const id = target.id ?? '';
  const hasTarget = Boolean(source && id);
  const catalog = isCatalogFavoriteSource(source);
  const year = normalizeYear(target.year);
  const searchTitle = target.searchTitle || undefined;

  const prefetchProps = usePlaybackIntentPrefetch({
    source: catalog ? undefined : source || undefined,
    id: catalog ? undefined : id || undefined,
    title: searchTitle || target.title,
    onPrefetch: () => {
      if (hasTarget && !catalog) void ensureFavoritesLoaded();
    },
  });

  useEffect(
    () => () => hideActionSheet(interactionId),
    [hideActionSheet, interactionId],
  );

  const toggleFavorite = useCallback(
    async (favorited: boolean) => {
      if (!favorited) {
        await saveFavorite(source, id, {
          title: target.title,
          source_name: target.sourceName ?? '',
          year,
          cover: target.cover,
          total_episodes: target.totalEpisodes ?? 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        showToast('已加入收藏', 'success');
        return;
      }
      showConfirm(interactionId, {
        objectKey: generateStorageKey(source, id),
        operation: 'favorite',
        title: '确认取消收藏？',
        message: `确认取消收藏「${target.title}」吗？`,
        danger: true,
        cancelText: '再想想',
        confirmText: '取消收藏',
        onConfirm: async () => {
          await deleteFavorite(source, id);
          showToast('已取消收藏', 'success');
        },
      });
    },
    [
      id,
      interactionId,
      searchTitle,
      showConfirm,
      source,
      target.cover,
      target.sourceName,
      target.title,
      target.totalEpisodes,
      year,
    ],
  );

  const openActions = useCallback(
    async (anchorRect: CardActionAnchor | null) => {
      // 目录作品收藏后会换绑到可播放源，收藏入口交给标记评分面板
      const canFavorite = hasTarget && !catalog;
      if (canFavorite) await ensureFavoritesLoaded();
      const favorited = canFavorite
        ? getFavoriteStatus(generateStorageKey(source, id))
        : false;
      const work = {
        source,
        id,
        title: target.title,
        year,
        cover: target.cover,
        searchTitle,
      };
      showActionSheet(interactionId, {
        objectKey: hasTarget ? generateStorageKey(source, id) : href,
        title: target.title,
        poster: target.cover,
        sourceName: target.sourceName,
        actions: buildCardActions({
          play: { onClick: () => router.push(href) },
          favorite: canFavorite
            ? { favorited, onToggle: () => toggleFavorite(favorited) }
            : undefined,
          addToList:
            openListPicker && hasTarget ? () => openListPicker(work) : null,
          watchRecord:
            openWatchRecord && hasTarget
              ? () =>
                  openWatchRecord({
                    ...work,
                    sourceName:
                      CATALOG_SOURCE_NAMES[source] ?? target.sourceName ?? '',
                    totalEpisodes: target.totalEpisodes,
                    doubanId: source === 'douban' ? Number(id) : undefined,
                  })
              : null,
          removeFromList: onRemoveFromList,
        }),
        anchorRect,
      });
    },
    [
      catalog,
      ensureFavoritesLoaded,
      getFavoriteStatus,
      hasTarget,
      href,
      id,
      interactionId,
      onRemoveFromList,
      openListPicker,
      openWatchRecord,
      router,
      searchTitle,
      showActionSheet,
      source,
      target.cover,
      target.sourceName,
      target.title,
      target.totalEpisodes,
      toggleFavorite,
      year,
    ],
  );

  // 触屏手势会拦下原生点击，短按由这里补上跳转
  const longPressProps = useLongPress({
    onLongPress: () => void openActions(null),
    onClick: () => router.push(href),
  });

  return {
    ...prefetchProps,
    ...longPressProps,
    style: noSelectStyle,
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      void openActions({
        top: event.clientY,
        left: event.clientX,
        width: 0,
        height: 0,
      });
    },
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
  };
}
