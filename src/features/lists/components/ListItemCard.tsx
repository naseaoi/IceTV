'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId } from 'react';

import {
  type CardActionAnchor,
  buildCardActions,
} from '@/components/card-actions/actions';
import { useCardInteractionManager } from '@/components/CardInteractionProvider';
import CoverImage from '@/components/CoverImage';
import { useOpenListPicker } from '@/components/list-picker-context';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import SkeletonText from '@/components/SkeletonText';
import { noSelectStyle } from '@/components/video-card/constants';
import { useOpenWatchRecord } from '@/components/watch-record-context';
import { listItemPlayUrl } from '@/features/lists/lib/list-links';
import type { ListItem } from '@/features/lists/types';
import { useLongPress } from '@/hooks/useLongPress';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import {
  deleteFavorite,
  generateStorageKey,
  saveFavorite,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';

// 卡片与骨架共用几何类，改动时两侧同步
const COVER_CLASS = 'aspect-[2/3] rounded-xl';
const TITLE_CLASS = 'mt-2 text-sm leading-5';
const META_CLASS = 'mt-0.5 text-xs leading-4';

const EDIT_BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black/85 disabled:pointer-events-none disabled:opacity-30';

function itemYear(item: ListItem) {
  return item.year && item.year !== 'unknown' ? item.year : '';
}

function CardBody({ item }: { item: ListItem }) {
  return (
    <>
      <h3
        className={`${TITLE_CLASS} truncate font-medium text-gray-900 transition-colors group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400`}
      >
        {item.title}
      </h3>
      <p className={`${META_CLASS} truncate text-gray-500 dark:text-gray-400`}>
        {itemYear(item) || ' '}
      </p>
    </>
  );
}

function Cover({ item }: { item: ListItem }) {
  return (
    <div
      className={`relative overflow-hidden bg-gray-100 dark:bg-gray-800 ${COVER_CLASS}`}
    >
      <CoverImage src={item.cover} alt={item.title} sizes='180px' />
    </div>
  );
}

const CATALOG_SOURCE_NAMES: Record<string, string> = {
  douban: '豆瓣',
  bangumi: 'Bangumi',
};

// 点击直达播放；登录后右键或长按展开与其他海报卡片一致的操作菜单
export function ListItemCard({
  item,
  guest = false,
  onRemove,
}: {
  item: ListItem;
  guest?: boolean;
  onRemove?: () => Promise<void>;
}) {
  if (guest) {
    return (
      <Link href={listItemPlayUrl(item)} className='group block'>
        <Cover item={item} />
        <CardBody item={item} />
      </Link>
    );
  }
  return <InteractiveListItemCard item={item} onRemove={onRemove} />;
}

function InteractiveListItemCard({
  item,
  onRemove,
}: {
  item: ListItem;
  onRemove?: () => Promise<void>;
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
  const href = listItemPlayUrl(item);
  const source = item.source;
  const id = item.sourceId ?? '';
  const hasTarget = Boolean(source && id);
  const catalog = isCatalogFavoriteSource(source);
  const year = itemYear(item);

  useEffect(
    () => () => hideActionSheet(interactionId),
    [hideActionSheet, interactionId],
  );

  const toggleFavorite = useCallback(
    async (favorited: boolean) => {
      if (!favorited) {
        await saveFavorite(source, id, {
          title: item.title,
          source_name: '',
          year,
          cover: item.cover,
          total_episodes: 1,
          save_time: Date.now(),
          search_title: item.searchTitle,
        });
        showToast('已加入收藏', 'success');
        return;
      }
      showConfirm(interactionId, {
        objectKey: generateStorageKey(source, id),
        operation: 'favorite',
        title: '确认取消收藏？',
        message: `确认取消收藏「${item.title}」吗？`,
        danger: true,
        cancelText: '再想想',
        confirmText: '取消收藏',
        onConfirm: async () => {
          await deleteFavorite(source, id);
          showToast('已取消收藏', 'success');
        },
      });
    },
    [id, interactionId, item, showConfirm, source, year],
  );

  const openActions = useCallback(
    async (anchorRect: CardActionAnchor | null) => {
      // 目录作品收藏后会换绑到可播放源，收藏入口交给标记评分面板
      const canFavorite = hasTarget && !catalog;
      if (canFavorite) await ensureFavoritesLoaded();
      const favorited = canFavorite
        ? getFavoriteStatus(generateStorageKey(source, id))
        : false;
      showActionSheet(interactionId, {
        objectKey: hasTarget ? generateStorageKey(source, id) : item.id,
        title: item.title,
        poster: item.cover,
        actions: buildCardActions({
          play: { onClick: () => router.push(href) },
          favorite: canFavorite
            ? { favorited, onToggle: () => toggleFavorite(favorited) }
            : undefined,
          addToList:
            openListPicker && hasTarget
              ? () =>
                  openListPicker({
                    source,
                    id,
                    title: item.title,
                    year,
                    cover: item.cover,
                    searchTitle: item.searchTitle || undefined,
                  })
              : null,
          watchRecord:
            openWatchRecord && hasTarget
              ? () =>
                  openWatchRecord({
                    source,
                    id,
                    title: item.title,
                    year,
                    cover: item.cover,
                    sourceName: CATALOG_SOURCE_NAMES[source] ?? '',
                    searchTitle: item.searchTitle || undefined,
                    doubanId: source === 'douban' ? Number(id) : undefined,
                  })
              : null,
          removeFromList: onRemove,
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
      item,
      onRemove,
      openListPicker,
      openWatchRecord,
      router,
      showActionSheet,
      source,
      toggleFavorite,
      year,
    ],
  );

  // 触屏手势会拦下原生点击，短按由这里补上跳转
  const longPressProps = useLongPress({
    onLongPress: () => void openActions(null),
    onClick: () => router.push(href),
  });

  return (
    <Link
      href={href}
      className='group block'
      style={noSelectStyle}
      onMouseEnter={() => {
        if (hasTarget && !catalog) void ensureFavoritesLoaded();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void openActions({
          top: event.clientY,
          left: event.clientX,
          width: 0,
          height: 0,
        });
      }}
      onDragStart={(event) => event.preventDefault()}
      {...longPressProps}
    >
      <Cover item={item} />
      <CardBody item={item} />
    </Link>
  );
}

export function EditableListItemCard({
  item,
  index,
  total,
  onMove,
  onRemove,
}: {
  item: ListItem;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className='relative'>
      <div className='relative'>
        <Cover item={item} />
        <span
          aria-hidden='true'
          className={`pointer-events-none absolute inset-0 bg-black/20 ${COVER_CLASS}`}
        />
        <button
          type='button'
          aria-label={`移出《${item.title}》`}
          onClick={onRemove}
          className={`${EDIT_BUTTON_CLASS} absolute right-2 top-2`}
        >
          <X className='h-4 w-4' />
        </button>
        <div className='absolute inset-x-2 bottom-2 flex justify-between'>
          <button
            type='button'
            aria-label={`《${item.title}》前移`}
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            className={EDIT_BUTTON_CLASS}
          >
            <ChevronLeft className='h-4 w-4' />
          </button>
          <span className='flex h-8 min-w-8 items-center justify-center rounded-full bg-black/70 px-2 text-xs font-medium tabular-nums text-white'>
            {index + 1}
          </span>
          <button
            type='button'
            aria-label={`《${item.title}》后移`}
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
            className={EDIT_BUTTON_CLASS}
          >
            <ChevronRight className='h-4 w-4' />
          </button>
        </div>
      </div>
      <CardBody item={item} />
    </div>
  );
}

export function ListItemGridSkeleton({ count }: { count: number }) {
  return (
    <div className={POSTER_GRID_CLASS} role='status' aria-label='加载中'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className={`skeleton ${COVER_CLASS}`} />
          <SkeletonText className={TITLE_CLASS} />
          <SkeletonText
            className={META_CLASS}
            barClassName='h-3 w-10 rounded'
          />
        </div>
      ))}
    </div>
  );
}
