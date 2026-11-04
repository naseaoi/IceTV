import { ExternalLink, Star } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import CoverImage from '@/components/CoverImage';
import { FavoriteHeartButton } from '@/components/FavoriteHeartButton';
import { PLAYER_PANEL_INSET_CLASS } from '@/components/PlayerPanelTabBar';
import RatingStars from '@/components/RatingStars';
import {
  INFO_COVER_CLASS,
  INFO_RATING_LINE_CLASS,
} from '@/features/play/components/EpisodeSelector/layout';
import { formatRating } from '@/lib/rating';
import { getVerticalScrollMaskStyle } from '@/lib/scroll-edge-fade';
import { normalizeWorkYear } from '@/lib/source-match';
import { SearchResult, VideoReview } from '@/lib/types';

export type InfoRating =
  | { kind: 'site'; average: number; count: number }
  | { kind: 'douban'; average: number }
  | { kind: 'none' };

interface InfoTabProps {
  videoTitle: string;
  detail: SearchResult | null;
  videoYear: string;
  favorited: boolean;
  onToggleFavorite: () => void;
  videoCover: string;
  videoDoubanId: number;
  scrollMode?: 'panel' | 'desc';
  myReview?: VideoReview | null;
  onOpenReview?: () => void;
  // null 表示评分未就绪，保留占位高度
  rating?: InfoRating | null;
}

const DESC_PARAGRAPH_SEPARATOR = /(?:\r?\n)+|[^\S\r\n]{2,}/;
const GENRE_SEPARATOR = /[,，、/|]+/;

export const InfoTab: React.FC<InfoTabProps> = ({
  videoTitle,
  detail,
  videoYear,
  favorited,
  onToggleFavorite,
  videoCover,
  videoDoubanId,
  scrollMode = 'panel',
  myReview = null,
  onOpenReview,
  rating = null,
}) => {
  const formattedDesc = useMemo(() => {
    const raw = detail?.desc;
    if (!raw) return '';

    const paragraphs = raw
      .split(DESC_PARAGRAPH_SEPARATOR)
      .map((p) => p.trim())
      .filter(Boolean);

    return paragraphs.join('\n');
  }, [detail?.desc]);

  const descOnlyScroll = scrollMode === 'desc';
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLParagraphElement>(null);
  const [hasTopFade, setHasTopFade] = useState(false);
  const [hasBottomFade, setHasBottomFade] = useState(false);

  const syncScrollFade = useCallback(() => {
    const panel = descOnlyScroll ? descRef.current : panelRef.current;
    if (!panel) return;

    const maxScrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
    setHasTopFade(panel.scrollTop > 4);
    setHasBottomFade(maxScrollTop > 4 && panel.scrollTop < maxScrollTop - 4);
  }, [descOnlyScroll]);

  useEffect(() => {
    const panel = descOnlyScroll ? descRef.current : panelRef.current;
    const content = descOnlyScroll ? descRef.current : contentRef.current;
    if (!panel || !content) return;

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(syncScrollFade);
    observer?.observe(panel);
    if (content !== panel) observer?.observe(content);
    const timer = window.setTimeout(syncScrollFade, 0);
    window.addEventListener('resize', syncScrollFade);

    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener('resize', syncScrollFade);
    };
  }, [descOnlyScroll, formattedDesc, syncScrollFade]);

  const doubanId =
    Number.isFinite(videoDoubanId) && videoDoubanId > 0 ? videoDoubanId : 0;
  const scrollMaskStyle = getVerticalScrollMaskStyle(hasTopFade, hasBottomFade);
  const metaItems = [
    normalizeWorkYear(detail?.year || videoYear),
    detail?.type_name,
  ].filter(Boolean);
  const genres = Array.from(
    new Set(
      (detail?.class || '')
        .split(GENRE_SEPARATOR)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

  const header = (
    <div
      className={`flex min-w-0 shrink-0 gap-4 ${
        descOnlyScroll ? `${PLAYER_PANEL_INSET_CLASS} pb-3 pt-5` : ''
      }`.trim()}
    >
      <div
        data-play-detail-cover
        className={`relative flex-shrink-0 overflow-hidden rounded-lg bg-gray-200 shadow-md shadow-black/10 ring-1 ring-black/10 dark:bg-gray-800 dark:shadow-black/30 dark:ring-white/10 ${INFO_COVER_CLASS}`}
      >
        <CoverImage
          src={videoCover}
          alt={videoTitle}
          sizes='(max-width: 1280px) 96px, 104px'
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
          className='absolute bottom-2.5 right-2.5 z-20'
        />
      </div>

      <div className='flex min-w-0 flex-1 flex-col justify-between gap-2'>
        <div className='min-w-0 space-y-1.5'>
          <h3 className='line-clamp-2 text-lg font-bold leading-snug text-gray-900 dark:text-gray-50'>
            {videoTitle || '影片标题'}
          </h3>
          {metaItems.length > 0 && (
            <p className='truncate text-[13px] text-gray-600 dark:text-gray-300'>
              {metaItems.join(' · ')}
            </p>
          )}
          {genres.length > 0 && (
            <ul
              aria-label='类型'
              className='flex max-h-[3.25rem] flex-wrap gap-1 overflow-hidden'
            >
              {genres.map((genre) => (
                <li
                  key={genre}
                  className='rounded bg-gray-900/[0.05] px-1.5 py-0.5 text-[11px] leading-4 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
                >
                  {genre}
                </li>
              ))}
            </ul>
          )}
          <div className={INFO_RATING_LINE_CLASS}>
            {rating &&
              (rating.kind === 'none' ? (
                <span className='text-xs text-gray-400 dark:text-gray-500'>
                  暂无评分
                </span>
              ) : (
                <>
                  <span className='text-[15px] font-semibold tabular-nums text-amber-600 dark:text-amber-400'>
                    {formatRating(rating.average)}
                  </span>
                  <RatingStars value={rating.average} size='sm' />
                  <span className='truncate text-xs text-gray-500 dark:text-gray-400'>
                    {rating.kind === 'site'
                      ? `${rating.count} 人评分`
                      : '豆瓣评分'}
                  </span>
                </>
              ))}
          </div>
        </div>

        <div className='-ml-0.5 flex flex-wrap items-center gap-1.5'>
          {onOpenReview && (
            <button
              type='button'
              aria-label={myReview ? '编辑我的评价' : '评分'}
              className='inline-flex h-7 items-center gap-1.5 rounded-full bg-gray-900/[0.05] px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-900/[0.09] dark:bg-white/[0.07] dark:text-gray-200 dark:hover:bg-white/[0.12] [&_svg]:text-amber-500'
              onClick={onOpenReview}
            >
              {myReview?.rating ? (
                <>
                  <RatingStars value={myReview.rating} size='sm' decorative />
                  <span className='font-semibold tabular-nums'>
                    {formatRating(myReview.rating)}
                  </span>
                </>
              ) : (
                <>
                  <Star className='h-3.5 w-3.5' />
                  {myReview ? '已评价' : '评分'}
                </>
              )}
            </button>
          )}
          {doubanId > 0 && (
            <a
              href={`https://movie.douban.com/subject/${doubanId}`}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-white'
            >
              豆瓣
              <ExternalLink className='h-3 w-3' />
            </a>
          )}
        </div>
      </div>
    </div>
  );

  const desc = formattedDesc ? (
    <p
      ref={descRef}
      data-play-detail-desc-scroll={descOnlyScroll ? '' : undefined}
      data-top-fade={descOnlyScroll ? hasTopFade : undefined}
      data-bottom-fade={descOnlyScroll ? hasBottomFade : undefined}
      className={`min-w-0 whitespace-pre-line break-words text-[13px] leading-[1.8] text-gray-600 dark:text-gray-400 ${
        descOnlyScroll
          ? `min-h-0 overflow-y-auto overflow-x-hidden pb-4 ${PLAYER_PANEL_INSET_CLASS}`
          : ''
      }`.trim()}
      onScroll={descOnlyScroll ? syncScrollFade : undefined}
      style={descOnlyScroll ? scrollMaskStyle : undefined}
    >
      {formattedDesc}
    </p>
  ) : null;

  // 桌面端由父级网格按内容高度分配简介与选集，这里只输出网格子项
  if (descOnlyScroll) {
    return (
      <div ref={contentRef} className='contents'>
        {header}
        {desc}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      data-play-detail-scroll-panel=''
      data-top-fade={hasTopFade}
      data-bottom-fade={hasBottomFade}
      className={`min-w-0 flex-1 overflow-y-auto overflow-x-hidden py-5 ${PLAYER_PANEL_INSET_CLASS}`}
      onScroll={syncScrollFade}
      style={scrollMaskStyle}
    >
      <div ref={contentRef} className='space-y-4'>
        {header}
        {desc}
      </div>
    </div>
  );
};
