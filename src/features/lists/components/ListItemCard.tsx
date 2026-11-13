'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';

import { useMediaCardMenu } from '@/components/card-actions/useMediaCardMenu';
import CoverImage from '@/components/CoverImage';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import SkeletonText from '@/components/SkeletonText';
import { WATCH_STATUS_OPTIONS } from '@/components/watch-record-context';
import { listItemPlayUrl } from '@/features/lists/lib/list-links';
import type { ListItem } from '@/features/lists/types';

// 卡片与骨架共用几何类，改动时两侧同步
const COVER_CLASS = 'aspect-[2/3] rounded-xl';
const TITLE_CLASS = 'mt-2 text-sm leading-5';
const META_CLASS = 'mt-0.5 text-xs leading-4';

const EDIT_BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black/85 disabled:pointer-events-none disabled:opacity-30';

function itemYear(item: ListItem) {
  return item.year && item.year !== 'unknown' ? item.year : '';
}

const STATUS_LABELS = new Map(
  WATCH_STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

function CardBody({ item }: { item: ListItem }) {
  const status = item.viewerStatus
    ? STATUS_LABELS.get(item.viewerStatus)
    : undefined;
  const meta = [itemYear(item), status].filter(Boolean).join(' · ');
  return (
    <>
      <h3
        className={`${TITLE_CLASS} truncate font-medium text-gray-900 transition-colors group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400`}
      >
        {item.title}
      </h3>
      <p className={`${META_CLASS} truncate text-gray-500 dark:text-gray-400`}>
        {meta || ' '}
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
  const href = listItemPlayUrl(item);
  const menuProps = useMediaCardMenu({
    target: {
      source: item.source,
      id: item.sourceId ?? '',
      title: item.title,
      year: item.year,
      cover: item.cover,
      searchTitle: item.searchTitle,
    },
    href,
    onRemoveFromList: onRemove,
  });

  return (
    <Link href={href} className='group block' prefetch={false} {...menuProps}>
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
