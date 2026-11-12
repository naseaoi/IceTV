import { Check } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import {
  POSTER_BADGE_CLASS,
  POSTER_BADGE_NEUTRAL_CLASS,
  POSTER_CARD_COVER_CLASS,
  POSTER_HOVER_SHADE_CLASS,
} from '@/components/poster-card-layout';
import PosterFavoriteButton from '@/components/PosterFavoriteButton';
import RatingBadge from '@/components/RatingBadge';
import SourceNameBadge from '@/components/SourceNameBadge';
import type {
  VideoCardDisplayConfig,
  VideoCardProps,
} from '@/components/video-card/types';

import { noSelectStyle, preventContextMenu } from './constants';

interface VideoCardPosterProps {
  title: string;
  poster: string;
  // 聚合卡片里其他源的封面，当前封面不可用时依次换用
  posterAlternates?: readonly string[];
  priority: boolean;
  origin: NonNullable<VideoCardProps['origin']>;
  from: VideoCardProps['from'];
  config: VideoCardDisplayConfig;
  sourceName?: string;
  rate?: string;
  myRating?: number;
  episodes?: number;
  currentEpisode?: number;
  hasUpdate?: boolean;
  availableEpisodes?: number;
  progress?: number;
  visibleFavorited: boolean;
  onToggleFavorite: React.MouseEventHandler<HTMLButtonElement>;
  onMarkUpdateRead?: React.MouseEventHandler<HTMLButtonElement>;
}

function formatEpisodeBadge(episodes: number, currentEpisode?: number) {
  return currentEpisode ? `${currentEpisode}/${episodes}` : `${episodes} 集`;
}

function usePosterWithAlternates(
  poster: string,
  alternates: readonly string[] | undefined,
) {
  const candidates = alternates?.length
    ? Array.from(new Set([poster, ...alternates].filter(Boolean)))
    : [poster];
  const candidatesKey = candidates.join('\n');
  const [fallback, setFallback] = useState({ key: candidatesKey, index: 0 });
  const index = fallback.key === candidatesKey ? fallback.index : 0;
  const hasNext = index < candidates.length - 1;
  // 同一张图可能重复上报失败，按当前序号换图保证只前进一步
  const advance = useCallback(
    () => setFallback({ key: candidatesKey, index: index + 1 }),
    [candidatesKey, index],
  );
  return {
    src: candidates[index] ?? '',
    onUnavailable: hasNext ? advance : undefined,
  };
}

export function VideoCardPoster({
  title,
  poster,
  posterAlternates,
  priority,
  origin,
  from,
  config,
  sourceName,
  rate,
  myRating,
  episodes,
  currentEpisode,
  hasUpdate = false,
  availableEpisodes,
  progress,
  visibleFavorited,
  onToggleFavorite,
  onMarkUpdateRead,
}: VideoCardPosterProps) {
  const rateValue = config.showRating ? Number.parseFloat(rate ?? '') : NaN;
  const showRate = rateValue > 0;
  const showEpisodeBadge = !showRate && (episodes ?? 0) > 1;
  const showSourceName = config.showSourceName && Boolean(sourceName);
  const showUpdate = hasUpdate && (availableEpisodes ?? 0) > 1;
  const cover = usePosterWithAlternates(poster, posterAlternates);

  return (
    <div
      className={`${POSTER_CARD_COVER_CLASS} poster-rounded-clip relative overflow-hidden ${
        origin === 'live' ? 'ring-1 ring-gray-300/80 dark:ring-gray-600/80' : ''
      }`}
      style={noSelectStyle}
      onContextMenu={preventContextMenu}
    >
      <CoverImage
        src={cover.src}
        onUnavailable={cover.onUnavailable}
        alt={title}
        priority={priority}
        fit={origin === 'live' ? 'contain' : 'cover'}
        checkClientCacheBeforeLoad={from === 'playrecord'}
      />

      <div className={POSTER_HOVER_SHADE_CLASS} />

      {(showSourceName || showEpisodeBadge || showRate) && (
        <div
          className='pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2'
          style={noSelectStyle}
        >
          {showSourceName && (
            <SourceNameBadge sourceName={sourceName} origin={origin} />
          )}
          {showEpisodeBadge && (
            <span
              data-card-episodes
              className={`ml-auto shrink-0 whitespace-nowrap ${POSTER_BADGE_NEUTRAL_CLASS}`}
            >
              {formatEpisodeBadge(episodes ?? 0, currentEpisode)}
            </span>
          )}
          {showRate && (
            <RatingBadge
              value={rateValue}
              variant='overlay'
              label='评分'
              className='ml-auto shrink-0'
            />
          )}
        </div>
      )}

      {showUpdate ? (
        <button
          type='button'
          data-card-update
          aria-label={`更新至 ${availableEpisodes} 集，点击标记已读`}
          className={`group/update absolute bottom-2 left-2 min-w-[4.75rem] justify-center bg-amber-500 font-semibold text-white ${POSTER_BADGE_CLASS}`}
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
          onClick={onMarkUpdateRead}
        >
          <span className='sm:group-hover/update:hidden'>
            更新至 {availableEpisodes} 集
          </span>
          <span
            className='hidden sm:group-hover/update:inline'
            aria-hidden='true'
          >
            <Check size={16} strokeWidth={3} />
          </span>
        </button>
      ) : (
        myRating !== undefined && (
          <RatingBadge
            value={myRating}
            variant='overlay'
            label='我的评分'
            className='absolute bottom-2 left-2'
          />
        )
      )}

      {config.showHeart && from !== 'search' && (
        <PosterFavoriteButton
          favorited={visibleFavorited}
          onClick={onToggleFavorite}
        />
      )}

      {config.showProgress && progress !== undefined && progress > 0 && (
        <div className='pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/30'>
          <div
            className='h-full bg-brand-500'
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}
