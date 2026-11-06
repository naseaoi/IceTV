'use client';

import { Link as LinkIcon, PlayCircleIcon } from 'lucide-react';
import React, { memo, useCallback, useEffect, useId } from 'react';

import {
  type CardActionAnchor,
  buildCardActions,
} from '@/components/card-actions/actions';
import { useOptionalCardInteractionManager } from '@/components/CardInteractionProvider';
import CoverImage from '@/components/CoverImage';
import {
  POSTER_CARD_COVER_CLASS,
  POSTER_CARD_FIXED_TITLE_ROW_CLASS,
} from '@/components/poster-card-layout';
import { useOpenWatchRecord } from '@/components/watch-record-context';
import { useLongPress } from '@/hooks/useLongPress';
import {
  buildExternalSubjectUrl,
  hasDisplayableRate,
  usePosterPlay,
} from '@/hooks/usePosterPlay';

const noSelectStyle = {
  WebkitUserSelect: 'none',
  userSelect: 'none',
  WebkitTouchCallout: 'none',
} as React.CSSProperties;

const preventContextMenu = (event: React.MouseEvent) => {
  event.preventDefault();
  return false;
};

interface PosterCardProps {
  title: string;
  poster: string;
  doubanId?: number;
  rate?: string;
  year?: string;
  type?: string;
  isBangumi?: boolean;
  priority?: boolean;
}

function arePosterCardPropsEqual(
  previous: Readonly<PosterCardProps>,
  next: Readonly<PosterCardProps>,
): boolean {
  return (
    previous.title === next.title &&
    previous.poster === next.poster &&
    previous.doubanId === next.doubanId &&
    previous.rate === next.rate &&
    previous.year === next.year &&
    previous.type === next.type &&
    previous.isBangumi === next.isBangumi &&
    previous.priority === next.priority
  );
}

function PosterCard({
  title,
  poster,
  doubanId,
  rate,
  year,
  type = '',
  isBangumi = false,
  priority = false,
}: PosterCardProps) {
  const interactionId = useId();
  const interactionManager = useOptionalCardInteractionManager();
  const showActionSheet = interactionManager?.showActionSheet;
  const hideActionSheet = interactionManager?.hideActionSheet;
  const openWatchRecord = useOpenWatchRecord();
  const externalUrl = buildExternalSubjectUrl(doubanId, isBangumi);
  const externalLinkLabel = isBangumi
    ? `打开${title}的 Bangumi 页面`
    : `打开${title}的豆瓣页面`;
  const {
    play: handlePlay,
    prefetch: handlePrefetch,
    cancelPrefetch,
  } = usePosterPlay({ title, year, type });

  // 桌面端点击即播放，右键在光标处展开菜单；触屏长按展开底部面板
  const openActionSheet = useCallback(
    (anchorRect?: CardActionAnchor) => {
      if (!showActionSheet) {
        return;
      }

      showActionSheet(interactionId, {
        title,
        poster,
        anchorRect,
        actions: buildCardActions({
          play: { onClick: handlePlay },
          watchRecord:
            openWatchRecord && doubanId
              ? () =>
                  openWatchRecord({
                    source: isBangumi ? 'bangumi' : 'douban',
                    id: String(doubanId),
                    title,
                    year,
                    cover: poster,
                    sourceName: isBangumi ? 'Bangumi' : '豆瓣',
                    doubanId: isBangumi ? undefined : doubanId,
                  })
              : null,
          external: externalUrl
            ? { url: externalUrl, bangumi: isBangumi }
            : null,
        }),
      });
    },
    [
      doubanId,
      externalUrl,
      handlePlay,
      interactionId,
      isBangumi,
      openWatchRecord,
      poster,
      showActionSheet,
      title,
      year,
    ],
  );

  const longPressProps = useLongPress({
    onLongPress: () => openActionSheet(),
    onClick: handlePlay,
    longPressDelay: 500,
  });

  useEffect(() => {
    return () => {
      hideActionSheet?.(interactionId);
    };
  }, [hideActionSheet, interactionId]);

  return (
    <div
      className='group relative w-full cursor-pointer rounded-lg bg-transparent transition-[transform,opacity] duration-300 ease-in-out hover:z-10 hover:scale-[1.025] active:scale-[0.97] active:opacity-80'
      onClick={handlePlay}
      onMouseEnter={handlePrefetch}
      onMouseLeave={cancelPrefetch}
      onFocus={handlePrefetch}
      onBlur={cancelPrefetch}
      {...longPressProps}
      style={
        {
          ...noSelectStyle,
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          pointerEvents: 'auto',
        } as React.CSSProperties
      }
      onContextMenu={(event) => {
        event.preventDefault();
        openActionSheet({
          top: event.clientY,
          left: event.clientX,
          width: 0,
          height: 0,
        });
      }}
      onDragStart={(event) => {
        event.preventDefault();
        return false;
      }}
    >
      <div
        className={`${POSTER_CARD_COVER_CLASS} poster-rounded-clip relative overflow-hidden`}
        style={noSelectStyle}
        onContextMenu={preventContextMenu}
      >
        <CoverImage src={poster} alt={title} priority={priority} />

        <div
          className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        />

        <div
          data-button='true'
          className='absolute inset-0 flex items-center justify-center opacity-0 transition-all delay-75 duration-300 ease-in-out group-hover:scale-100 group-hover:opacity-100'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          <PlayCircleIcon
            size={50}
            strokeWidth={0.8}
            className='fill-transparent text-white transition-all duration-300 ease-out hover:scale-[1.1] hover:fill-brand-500'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          />
        </div>

        {hasDisplayableRate(rate) && (
          <div
            className='absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-4 text-amber-300'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            {rate}
          </div>
        )}

        {externalUrl && (
          <a
            href={externalUrl}
            target='_blank'
            rel='noopener noreferrer'
            onClick={(event) => event.stopPropagation()}
            className='absolute left-2 top-2 -translate-x-2 opacity-0 transition-all delay-100 duration-300 ease-in-out sm:group-hover:translate-x-0 sm:group-hover:opacity-100'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
            aria-label={externalLinkLabel}
            title={externalLinkLabel}
          >
            <div
              className='flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white transition-colors duration-200 hover:bg-brand-500'
              style={noSelectStyle}
              onContextMenu={preventContextMenu}
            >
              <LinkIcon
                size={16}
                aria-hidden='true'
                style={
                  {
                    ...noSelectStyle,
                    pointerEvents: 'none',
                  } as React.CSSProperties
                }
              />
            </div>
          </a>
        )}
      </div>

      <div
        className={POSTER_CARD_FIXED_TITLE_ROW_CLASS}
        style={noSelectStyle}
        onContextMenu={preventContextMenu}
      >
        <div className='relative' style={noSelectStyle}>
          <span
            className='peer block truncate font-medium text-gray-800 transition-colors duration-200 group-hover:text-brand-600 dark:text-gray-200 dark:group-hover:text-brand-300'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            {title}
          </span>
          <div
            className='pointer-events-none invisible absolute bottom-full left-1/2 mb-2 -translate-x-1/2 transform whitespace-nowrap rounded-md bg-gray-800 px-3 py-1 text-xs text-white opacity-0 shadow-lg transition-all delay-100 duration-200 ease-out peer-hover:visible peer-hover:opacity-100'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            {title}
            <div
              className='absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 transform border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'
              style={noSelectStyle}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(PosterCard, arePosterCardPropsEqual);
