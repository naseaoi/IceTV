import { Link, PlayCircleIcon, Trash2 } from 'lucide-react';
import type React from 'react';

import CoverImage from '@/components/CoverImage';
import { FavoriteHeartButton } from '@/components/FavoriteHeartButton';
import SourceNameBadge from '@/components/SourceNameBadge';
import type {
  VideoCardDisplayConfig,
  VideoCardProps,
} from '@/components/video-card/types';

import { noSelectStyle, preventContextMenu } from './constants';

const PRIORITY_SOURCES = [
  '爱奇艺',
  '腾讯视频',
  '优酷',
  '芒果TV',
  '哔哩哔哩',
  'Netflix',
  'Disney+',
];

function sortSourceNames(sourceNames: string[]): string[] {
  return [...sourceNames].sort((left, right) => {
    const leftIndex = PRIORITY_SOURCES.indexOf(left);
    const rightIndex = PRIORITY_SOURCES.indexOf(right);
    if (leftIndex !== -1 && rightIndex !== -1) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== -1) {
      return -1;
    }
    if (rightIndex !== -1) {
      return 1;
    }
    return left.localeCompare(right);
  });
}

interface AggregateSourcesIndicatorProps {
  sourceNames: string[];
}

function AggregateSourcesIndicator({
  sourceNames,
}: AggregateSourcesIndicatorProps) {
  const uniqueSources = Array.from(new Set(sourceNames));
  const sortedSources = sortSourceNames(uniqueSources);
  const maxDisplayCount = 6;
  const displaySources = sortedSources.slice(0, maxDisplayCount);
  const hasMore = sortedSources.length > maxDisplayCount;
  const remainingCount = sortedSources.length - maxDisplayCount;

  return (
    <div
      className='absolute bottom-2 right-2 opacity-0 transition-all delay-75 duration-300 ease-in-out sm:group-hover:opacity-100'
      style={noSelectStyle}
      onContextMenu={preventContextMenu}
    >
      <div className='group/sources relative' style={noSelectStyle}>
        <div
          className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-white shadow-md transition-all duration-300 ease-out hover:scale-[1.1] hover:bg-gray-600 sm:h-7 sm:w-7'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          {sortedSources.length}
        </div>

        <div
          className='pointer-events-none invisible absolute bottom-full right-0 z-50 mb-2 -translate-x-0 opacity-0 transition-all delay-100 duration-200 ease-out group-hover/sources:visible group-hover/sources:opacity-100 sm:right-0 sm:translate-x-0'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          <div
            className='w-[7em] overflow-hidden rounded-lg border border-white/10 bg-gray-800/90 p-1.5 text-xs text-white shadow-xl backdrop-blur-sm sm:w-[7.5em] sm:p-2 sm:text-xs'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            <div className='space-y-0.5 sm:space-y-1'>
              {displaySources.map((sourceName) => (
                <div
                  key={sourceName}
                  className='flex min-w-0 items-center gap-1 sm:gap-1.5'
                >
                  <div className='h-0.5 w-0.5 flex-shrink-0 rounded-full bg-blue-400 sm:h-1 sm:w-1'></div>
                  <span
                    className='block w-[4em] shrink-0 truncate text-[10px] leading-tight sm:text-xs'
                    title={sourceName}
                  >
                    {sourceName}
                  </span>
                </div>
              ))}
            </div>

            {hasMore && (
              <div className='mt-1 border-t border-gray-700/50 pt-1 sm:mt-2 sm:pt-1.5'>
                <div className='flex items-center justify-center text-gray-400'>
                  <span className='text-[10px] font-medium sm:text-xs'>
                    +{remainingCount} 播放源
                  </span>
                </div>
              </div>
            )}

            <div className='absolute right-2 top-full h-0 w-0 border-l-[4px] border-r-[4px] border-t-[4px] border-transparent border-t-gray-800/90 sm:right-3 sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px]'></div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface VideoCardPosterProps {
  title: string;
  poster: string;
  priority: boolean;
  origin: NonNullable<VideoCardProps['origin']>;
  from: VideoCardProps['from'];
  config: VideoCardDisplayConfig;
  sourceName?: string;
  year?: string;
  rate?: string;
  episodes?: number;
  currentEpisode?: number;
  hasUpdate?: boolean;
  availableEpisodes?: number;
  doubanId?: number;
  isBangumi: boolean;
  isAggregate: boolean;
  sourceNames?: string[];
  progress?: number;
  visibleFavorited: boolean;
  onDeleteRecord: React.MouseEventHandler<SVGSVGElement>;
  onToggleFavorite: React.MouseEventHandler<HTMLButtonElement>;
  onMarkUpdateRead?: React.MouseEventHandler<HTMLButtonElement>;
}

export function VideoCardPoster({
  title,
  poster,
  priority,
  origin,
  from,
  config,
  sourceName,
  year,
  rate,
  episodes,
  currentEpisode,
  hasUpdate = false,
  availableEpisodes,
  doubanId,
  isBangumi,
  isAggregate,
  sourceNames,
  progress,
  visibleFavorited,
  onDeleteRecord,
  onToggleFavorite,
  onMarkUpdateRead,
}: VideoCardPosterProps) {
  const displayYear = String(year ?? '').trim();
  const showEpisodeBadge = (episodes ?? 0) > 1;

  return (
    <div
      className={`poster-rounded-clip relative aspect-[2/3] overflow-hidden rounded-lg ${
        origin === 'live' ? 'ring-1 ring-gray-300/80 dark:ring-gray-600/80' : ''
      }`}
      style={noSelectStyle}
      onContextMenu={preventContextMenu}
    >
      <CoverImage
        src={poster}
        alt={title}
        priority={priority}
        fit={origin === 'live' ? 'contain' : 'cover'}
        checkClientCacheBeforeLoad={from === 'playrecord'}
      />

      <div
        className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100'
        style={noSelectStyle}
        onContextMenu={preventContextMenu}
      />

      {(config.showSourceName || showEpisodeBadge) && (
        <div
          className='absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          {config.showSourceName && (
            <SourceNameBadge
              sourceName={sourceName}
              origin={origin}
              className={
                config.showDoubanLink ? 'sm:group-hover:opacity-0' : ''
              }
            />
          )}
          {showEpisodeBadge && (
            <div
              className='ml-auto flex-shrink-0 whitespace-nowrap rounded-md bg-green-500 px-2 py-1 text-xs font-semibold text-white shadow-md transition-all duration-300 ease-out group-hover:scale-110 max-sm:px-1.5 max-sm:py-0.5 max-sm:text-[10px]'
              style={noSelectStyle}
              onContextMenu={preventContextMenu}
            >
              {currentEpisode ? `${currentEpisode}/${episodes}` : episodes}
            </div>
          )}
        </div>
      )}

      {config.showPlayButton && (
        <div
          data-button='true'
          className='absolute inset-0 flex items-center justify-center opacity-0 transition-all delay-75 duration-300 ease-in-out group-hover:scale-100 group-hover:opacity-100'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          <PlayCircleIcon
            size={50}
            strokeWidth={0.8}
            className='fill-transparent text-white transition-all duration-300 ease-out hover:scale-[1.1] hover:fill-green-500'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          />
        </div>
      )}

      {(config.showHeart || config.showCheckCircle) && (
        <div
          data-button='true'
          className='absolute bottom-3 right-3 flex translate-y-2 gap-3 opacity-0 transition-all duration-300 ease-in-out sm:group-hover:translate-y-0 sm:group-hover:opacity-100'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          {config.showCheckCircle && (
            <Trash2
              onClick={onDeleteRecord}
              size={20}
              className='text-white transition-all duration-300 ease-out hover:scale-[1.1] hover:stroke-red-500'
              style={noSelectStyle}
              onContextMenu={preventContextMenu}
            />
          )}
          {config.showHeart && from !== 'search' && (
            <FavoriteHeartButton
              favorited={visibleFavorited}
              onClick={onToggleFavorite}
              unfavoritedIconClassName={
                from === 'playrecord'
                  ? 'fill-transparent stroke-white hover:fill-red-400 hover:stroke-red-400'
                  : undefined
              }
              style={noSelectStyle}
              onContextMenu={preventContextMenu}
            />
          )}
        </div>
      )}

      {config.showYear &&
        displayYear &&
        displayYear !== 'unknown' &&
        displayYear !== '0' && (
          <div
            data-card-year
            className='absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-sm transition-all duration-300 ease-out group-hover:opacity-90'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            {displayYear}
          </div>
        )}

      {config.showRating && rate && (
        <div
          className='absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-pink-500 text-xs font-bold text-white shadow-md transition-all duration-300 ease-out group-hover:scale-110'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          {rate}
        </div>
      )}

      {config.showDoubanLink && doubanId && doubanId !== 0 && (
        <a
          href={
            isBangumi
              ? `https://bgm.tv/subject/${doubanId.toString()}`
              : `https://movie.douban.com/subject/${doubanId.toString()}`
          }
          target='_blank'
          rel='noopener noreferrer'
          onClick={(event) => event.stopPropagation()}
          className='absolute left-2 top-2 z-20 -translate-x-2 opacity-0 transition-all delay-100 duration-300 ease-in-out sm:group-hover:translate-x-0 sm:group-hover:opacity-100'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          <div
            className='flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white shadow-md transition-all duration-300 ease-out hover:scale-[1.1] hover:bg-green-600'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            <Link
              size={16}
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

      {hasUpdate && availableEpisodes && availableEpisodes > 1 && (
        <button
          type='button'
          data-card-update
          aria-label={`更新至 ${availableEpisodes} 集，点击标记已读`}
          className='group/update absolute bottom-2 left-2 min-w-[4.75rem] rounded-md bg-amber-500 px-2 py-1 text-xs font-semibold text-white shadow-md'
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
            ✅
          </span>
        </button>
      )}

      {isAggregate && sourceNames && sourceNames.length > 0 && (
        <AggregateSourcesIndicator sourceNames={sourceNames} />
      )}

      {config.showProgress && progress !== undefined && progress > 0 && (
        <div
          className='absolute bottom-0 left-0 right-0 h-1 bg-black/30'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          <div
            className='h-full bg-green-500 transition-all duration-500 ease-out'
            style={
              {
                width: `${progress}%`,
                ...noSelectStyle,
              } as React.CSSProperties
            }
            onContextMenu={preventContextMenu}
          />
        </div>
      )}
    </div>
  );
}
