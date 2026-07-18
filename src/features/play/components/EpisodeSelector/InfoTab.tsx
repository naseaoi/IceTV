import { ExternalLink } from 'lucide-react';
import React, { useMemo } from 'react';

import CoverImage from '@/components/CoverImage';
import { FavoriteHeartButton } from '@/components/FavoriteHeartButton';
import { SearchResult } from '@/lib/types';

interface InfoTabProps {
  videoTitle: string;
  totalEpisodes: number;
  detail: SearchResult | null;
  videoYear: string;
  favorited: boolean;
  onToggleFavorite: () => void;
  videoCover: string;
  videoDoubanId: number;
  scrollMode?: 'panel' | 'desc';
}

const DESC_PARAGRAPH_SEPARATOR = /(?:\r?\n)+|[^\S\r\n]{2,}/;

export const InfoTab: React.FC<InfoTabProps> = ({
  videoTitle,
  totalEpisodes,
  detail,
  videoYear,
  favorited,
  onToggleFavorite,
  videoCover,
  videoDoubanId,
  scrollMode = 'panel',
}) => {
  const formattedDesc = useMemo(() => {
    const raw = detail?.desc;
    if (!raw) return '';

    const paragraphs = raw
      .split(DESC_PARAGRAPH_SEPARATOR)
      .map((p) => p.trim())
      .filter(Boolean);

    return paragraphs.map((p) => `　　${p}`).join('\n');
  }, [detail?.desc]);

  const descOnlyScroll = scrollMode === 'desc';
  const doubanId =
    Number.isFinite(videoDoubanId) && videoDoubanId > 0 ? videoDoubanId : 0;
  const descStyle = descOnlyScroll
    ? {
        whiteSpace: 'pre-line',
        WebkitMaskImage:
          'linear-gradient(to bottom, #000 calc(100% - 2rem), transparent 100%)',
        maskImage:
          'linear-gradient(to bottom, #000 calc(100% - 2rem), transparent 100%)',
      }
    : { whiteSpace: 'pre-line' };

  return (
    <div
      className={
        descOnlyScroll
          ? 'flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden px-5 pb-1 pt-4 sm:px-6 sm:pb-1 sm:pt-5'
          : 'min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-5 sm:p-6'
      }
    >
      <div className='flex min-w-0 flex-shrink-0 gap-4 sm:gap-5'>
        <div
          data-play-detail-cover
          className='relative aspect-[2/3] w-24 flex-shrink-0 overflow-hidden rounded-xl bg-gray-200 shadow-md shadow-black/10 ring-1 ring-black/10 dark:bg-gray-800 dark:shadow-black/30 dark:ring-white/10 sm:w-28 xl:w-32'
        >
          <CoverImage
            src={videoCover}
            alt={videoTitle}
            sizes='(max-width: 640px) 96px, (max-width: 1280px) 112px, 128px'
            quality={60}
            priority
          />
          <FavoriteHeartButton
            favorited={favorited}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFavorite();
            }}
            className='absolute bottom-3 right-3 z-20'
          />
        </div>

        <div className='flex min-w-0 flex-1 flex-col justify-end gap-2.5 pb-0.5'>
          <h3 className='line-clamp-2 min-w-0 max-w-full text-base font-bold leading-snug text-gray-900 dark:text-gray-100'>
            {videoTitle || '影片标题'}
          </h3>

          {doubanId > 0 && (
            <a
              href={`https://movie.douban.com/subject/${doubanId}`}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex w-fit items-center gap-1 text-[11px] font-medium text-emerald-600 transition-colors hover:text-emerald-700 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300'
            >
              <ExternalLink className='h-3 w-3' />
              豆瓣
            </a>
          )}

          <div className='flex flex-wrap gap-1.5'>
            {detail?.source_name && (
              <span className='inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-500/20'>
                {detail.source_name}
              </span>
            )}
          </div>

          <div className='flex flex-wrap gap-1.5'>
            {(detail?.year || videoYear) && (
              <span className='inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400'>
                {detail?.year || videoYear}
              </span>
            )}
            {totalEpisodes > 1 && (
              <span className='inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'>
                共 {totalEpisodes} 集
              </span>
            )}
          </div>

          {(detail?.class || detail?.type_name) && (
            <div className='flex flex-wrap gap-1.5'>
              {detail?.class && (
                <span className='inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'>
                  {detail.class}
                </span>
              )}
              {detail?.type_name && (
                <span className='inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'>
                  {detail.type_name}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {detail?.desc && (
        <div
          className={
            descOnlyScroll
              ? 'flex min-h-0 flex-1 flex-col pt-1'
              : 'flex flex-col pt-1'
          }
        >
          <div className={descOnlyScroll ? 'relative min-h-0 flex-1' : ''}>
            <p
              className={`max-w-full break-words text-[13px] leading-[1.8] text-gray-600 dark:text-gray-400 ${
                descOnlyScroll
                  ? 'h-full min-h-0 overflow-y-auto overflow-x-hidden pb-5'
                  : ''
              }`.trim()}
              style={descStyle}
            >
              {formattedDesc}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
