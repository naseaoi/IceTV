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
import RatingStars from '@/components/RatingStars';
import { formatRating } from '@/lib/rating';
import { getVerticalScrollMaskStyle } from '@/lib/scroll-edge-fade';
import { normalizeWorkYear } from '@/lib/source-match';
import { SearchResult, VideoReview } from '@/lib/types';

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
  myReview?: VideoReview | null;
  onOpenReview?: () => void;
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
  myReview = null,
  onOpenReview,
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
  const descStyle = {
    whiteSpace: 'pre-line' as const,
    ...(descOnlyScroll ? scrollMaskStyle : undefined),
  };

  return (
    <div
      ref={panelRef}
      data-play-detail-scroll-panel={!descOnlyScroll ? '' : undefined}
      data-top-fade={!descOnlyScroll ? hasTopFade : undefined}
      data-bottom-fade={!descOnlyScroll ? hasBottomFade : undefined}
      className={
        descOnlyScroll
          ? 'flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden px-5 pb-1 pt-4 sm:px-6 sm:pb-1 sm:pt-5'
          : 'min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-5 sm:p-6'
      }
      onScroll={!descOnlyScroll ? syncScrollFade : undefined}
      style={!descOnlyScroll ? scrollMaskStyle : undefined}
    >
      <div
        ref={contentRef}
        className={descOnlyScroll ? 'contents' : 'space-y-3'}
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

            <div className='flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400'>
              {[
                detail?.source_name,
                normalizeWorkYear(detail?.year || videoYear),
                totalEpisodes > 1 ? `共 ${totalEpisodes} 集` : '',
                detail?.type_name,
              ]
                .filter(Boolean)
                .map((item, index) => (
                  <span
                    key={index}
                    className='inline-flex items-center gap-1.5'
                  >
                    {index > 0 && (
                      <span className='text-gray-300 dark:text-gray-600'>
                        ·
                      </span>
                    )}
                    {item}
                  </span>
                ))}
              {doubanId > 0 && (
                <a
                  href={`https://movie.douban.com/subject/${doubanId}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='ml-1 inline-flex items-center gap-0.5 text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                >
                  豆瓣
                  <ExternalLink className='h-3 w-3' />
                </a>
              )}
            </div>

            {detail?.class && (
              <div className='line-clamp-1 text-xs text-gray-400 dark:text-gray-500'>
                {detail.class}
              </div>
            )}

            {onOpenReview && (
              <button
                type='button'
                aria-label={myReview ? '编辑我的评价' : '评分'}
                className='inline-flex h-7 w-fit items-center gap-1.5 rounded-full bg-gray-900/[0.05] px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-900/[0.09] dark:bg-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.12] [&_svg]:text-amber-500'
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
                ref={descRef}
                data-play-detail-desc-scroll={descOnlyScroll ? '' : undefined}
                data-top-fade={descOnlyScroll ? hasTopFade : undefined}
                data-bottom-fade={descOnlyScroll ? hasBottomFade : undefined}
                className={`max-w-full break-words text-[13px] leading-[1.8] text-gray-600 dark:text-gray-400 ${
                  descOnlyScroll
                    ? 'h-full min-h-0 overflow-y-auto overflow-x-hidden pb-5'
                    : ''
                }`.trim()}
                onScroll={descOnlyScroll ? syncScrollFade : undefined}
                style={descStyle}
              >
                {formattedDesc}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
