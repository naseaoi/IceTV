import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SearchResult } from '@/lib/types';
import { normalizeInlineText } from '@/lib/utils';

interface EpisodesTabProps {
  totalEpisodes: number;
  episodes_titles: string[];
  episodesPerPage: number;
  value: number;
  onChange?: (episodeNumber: number) => void;
  variantSources?: SearchResult[];
  currentSource?: string;
  currentId?: string;
  onSourceChange?: (source: string, id: string, title: string) => void;
}

export const EpisodesTab: React.FC<EpisodesTabProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage,
  value,
  onChange,
  variantSources = [],
  currentSource,
  currentId,
  onSourceChange,
}) => {
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const showPagination = pageCount > 1;

  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  const categories = useMemo(() => {
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);

  const preventPageScroll = useCallback(
    (e: WheelEvent) => {
      if (isCategoryHovered) e.preventDefault();
    },
    [isCategoryHovered],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (isCategoryHovered && categoryContainerRef.current) {
        e.preventDefault();
        categoryContainerRef.current.scrollBy({
          left: e.deltaY * 2,
          behavior: 'smooth',
        });
      }
    },
    [isCategoryHovered],
  );

  useEffect(() => {
    if (isCategoryHovered) {
      document.addEventListener('wheel', preventPageScroll, { passive: false });
      document.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    }
    return () => {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isCategoryHovered, preventPageScroll, handleWheel]);

  useEffect(() => {
    const btn = buttonRefs.current[currentPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const targetScrollLeft =
        btnLeft - (containerRect.width - btnRect.width) / 2;
      container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
    }
  }, [currentPage, pageCount]);

  useEffect(() => {
    setCurrentPage(Math.floor((value - 1) / episodesPerPage));
  }, [episodesPerPage, value]);

  const handleCategoryClick = useCallback((index: number) => {
    setCurrentPage(index);
  }, []);

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes,
  );

  return (
    <>
      {(variantSources.length > 1 || showPagination) && (
        <div className='flex flex-shrink-0 flex-col gap-3 px-5 py-3 sm:px-6'>
          {variantSources.length > 1 && (
            <div className='flex flex-wrap justify-center gap-2'>
              {variantSources.map((variant, index) => {
                const isActive =
                  variant.source === currentSource && variant.id === currentId;
                const episodeCount = Math.max(
                  variant.episodes.length,
                  variant.episodes_titles.length,
                );
                const variantLabel = normalizeInlineText(
                  variant.variant_label || `版本${index + 1}`,
                );

                return (
                  <button
                    key={`${variant.source}-${variant.id}`}
                    onClick={() => {
                      if (!isActive) {
                        onSourceChange?.(
                          variant.source,
                          variant.id,
                          variant.title,
                        );
                      }
                    }}
                    className={`inline-flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150
                      ${
                        isActive
                          ? 'bg-green-500 text-white shadow-sm shadow-green-500/20'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.12]'
                      }
                    `.trim()}
                    title={variantLabel}
                  >
                    <span className='max-w-[10rem] truncate'>
                      {variantLabel}
                    </span>
                    {episodeCount > 0 && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px]
                          ${
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-black/5 text-gray-500 dark:bg-white/10 dark:text-gray-400'
                          }
                        `.trim()}
                      >
                        {episodeCount}集
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {showPagination && (
            <div
              className='overflow-x-auto'
              ref={categoryContainerRef}
              onMouseEnter={() => setIsCategoryHovered(true)}
              onMouseLeave={() => setIsCategoryHovered(false)}
            >
              <div className='flex w-max min-w-full justify-center gap-1'>
                {categories.map((label, idx) => {
                  const isActive = idx === currentPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150
                        ${
                          isActive
                            ? 'bg-green-500 text-white shadow-sm'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200'
                        }
                      `.trim()}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {showPagination && (
        <div className='mx-5 h-px bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/[0.10] sm:mx-6' />
      )}

      <div className='flex flex-1 flex-wrap content-start justify-center gap-2 overflow-y-auto p-5 sm:p-6'>
        {(() => {
          const len = currentEnd - currentStart + 1;
          return Array.from({ length: len }, (_, i) => currentStart + i);
        })().map((episodeNumber) => {
          const isActive = episodeNumber === value;
          const rawTitle = episodes_titles?.[episodeNumber - 1];
          const match = rawTitle?.match(/(?:第)?(\d+)(?:集|话)/);
          const displayTitle = rawTitle
            ? match
              ? match[1]
              : rawTitle
            : `${episodeNumber}`;
          const estimatedPx = Array.from(displayTitle).reduce(
            (sum, char) =>
              sum +
              (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)
                ? 13
                : 7.5),
            0,
          );
          const dynamicSpan = Math.max(
            1,
            Math.min(3, Math.ceil((estimatedPx + 24) / 56)),
          );
          return (
            <button
              key={episodeNumber}
              onClick={() => onChange?.(episodeNumber - 1)}
              style={{
                width: `calc(${dynamicSpan} * 3rem + ${dynamicSpan - 1} * 0.5rem)`,
              }}
              className={`h-11 ${dynamicSpan > 1 ? 'px-2' : 'px-1'} flex shrink-0 items-center justify-center rounded-lg text-[13px] font-medium transition-all duration-150
                ${
                  isActive
                    ? 'bg-green-500 text-white shadow-md shadow-green-500/20'
                    : 'bg-gray-100 text-gray-700 hover:scale-105 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.12]'
                }`.trim()}
              title={rawTitle || `第 ${episodeNumber} 集`}
            >
              <span className='truncate'>{displayTitle}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};
