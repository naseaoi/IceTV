'use client';

import React, { memo, useCallback, useEffect, useId } from 'react';

import {
  type CardActionAnchor,
  buildCardActions,
} from '@/components/card-actions/actions';
import { useOptionalCardInteractionManager } from '@/components/CardInteractionProvider';
import CoverImage from '@/components/CoverImage';
import { useOpenListPicker } from '@/components/list-picker-context';
import {
  POSTER_CARD_COVER_CLASS,
  POSTER_CARD_FIXED_TITLE_ROW_CLASS,
  POSTER_CARD_INTERACTION_CLASS,
  POSTER_HOVER_SHADE_CLASS,
} from '@/components/poster-card-layout';
import RatingBadge from '@/components/RatingBadge';
import {
  noSelectStyle,
  preventContextMenu,
} from '@/components/video-card/constants';
import { VideoCardTitle } from '@/components/video-card/VideoCardTitle';
import { useOpenWatchRecord } from '@/components/watch-record-context';
import { useLongPress } from '@/hooks/useLongPress';
import {
  buildExternalSubjectUrl,
  hasDisplayableRate,
  usePosterPlay,
} from '@/hooks/usePosterPlay';

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
  const openListPicker = useOpenListPicker();
  const externalUrl = buildExternalSubjectUrl(doubanId, isBangumi);
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
          addToList:
            openListPicker && doubanId
              ? () =>
                  openListPicker({
                    source: isBangumi ? 'bangumi' : 'douban',
                    id: String(doubanId),
                    title,
                    year,
                    cover: poster,
                  })
              : null,
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
      openListPicker,
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
      className={POSTER_CARD_INTERACTION_CLASS}
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

        <div className={POSTER_HOVER_SHADE_CLASS} />

        {hasDisplayableRate(rate) && (
          <RatingBadge
            value={Number.parseFloat(rate)}
            variant='overlay'
            label='评分'
            className='absolute right-2 top-2'
          />
        )}
      </div>

      <VideoCardTitle
        title={title}
        className={POSTER_CARD_FIXED_TITLE_ROW_CLASS}
      />
    </div>
  );
}

export default memo(PosterCard, arePosterCardPropsEqual);
