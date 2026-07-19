import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { EpisodeGroup, SearchResult } from '@/lib/types';
import { normalizeInlineText } from '@/lib/utils';

interface EpisodePage {
  label: string;
  start: number;
  end: number;
}

interface EpisodesTabProps {
  totalEpisodes: number;
  episodes_titles: string[];
  episodesPerPage: number;
  value: number;
  onChange?: (episodeNumber: number) => void;
  episodeGroups?: EpisodeGroup[];
  variantSources?: SearchResult[];
  currentSource?: string;
  currentId?: string;
  onSourceChange?: (source: string, id: string, title: string) => void;
}

function buildNumericPages(
  totalEpisodes: number,
  episodesPerPage: number,
): EpisodePage[] {
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);
  return Array.from({ length: pageCount }, (_, i) => {
    const start = i * episodesPerPage + 1;
    const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
    return { label: `${start}-${end}`, start, end };
  });
}

function buildGroupPages(
  groups: EpisodeGroup[],
  episodesPerPage: number,
): EpisodePage[] {
  const pages: EpisodePage[] = [];
  let start = 1;

  for (const group of groups) {
    const groupEnd = start + group.count - 1;
    if (group.count <= episodesPerPage) {
      pages.push({ label: group.label, start, end: groupEnd });
    } else {
      for (
        let pageStart = start;
        pageStart <= groupEnd;
        pageStart += episodesPerPage
      ) {
        const pageEnd = Math.min(pageStart + episodesPerPage - 1, groupEnd);
        pages.push({
          label: `${group.label} ${pageStart - start + 1}-${pageEnd - start + 1}`,
          start: pageStart,
          end: pageEnd,
        });
      }
    }
    start = groupEnd + 1;
  }

  return pages;
}

export const EpisodesTab: React.FC<EpisodesTabProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage,
  value,
  onChange,
  episodeGroups,
  variantSources = [],
  currentSource,
  currentId,
  onSourceChange,
}) => {
  const pages = useMemo(() => {
    const groupTotal = (episodeGroups || []).reduce(
      (sum, group) => sum + group.count,
      0,
    );
    if (
      episodeGroups &&
      episodeGroups.length > 1 &&
      groupTotal === totalEpisodes
    ) {
      return buildGroupPages(episodeGroups, episodesPerPage);
    }
    return buildNumericPages(totalEpisodes, episodesPerPage);
  }, [episodeGroups, episodesPerPage, totalEpisodes]);

  const findPageIndex = useCallback(
    (episodeNumber: number) => {
      const index = pages.findIndex(
        (page) => episodeNumber >= page.start && episodeNumber <= page.end,
      );
      return index >= 0 ? index : 0;
    },
    [pages],
  );

  const [currentPage, setCurrentPage] = useState<number>(() =>
    findPageIndex(value),
  );
  const pageCount = pages.length;
  const showPagination = pageCount > 1;

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const episodeContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const episodeButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);
  const [hasEpisodeTopFade, setHasEpisodeTopFade] = useState(false);
  const [hasEpisodeBottomFade, setHasEpisodeBottomFade] = useState(false);

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
    setCurrentPage(findPageIndex(value));
  }, [findPageIndex, value]);

  const handleCategoryClick = useCallback((index: number) => {
    setCurrentPage(index);
  }, []);

  const syncEpisodeFade = useCallback(() => {
    const container = episodeContainerRef.current;
    if (!container) return;

    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    setHasEpisodeTopFade(container.scrollTop > 4);
    setHasEpisodeBottomFade(container.scrollTop < maxScrollTop - 4);
  }, []);

  const activePage = pages[Math.min(currentPage, pageCount - 1)] || {
    label: '',
    start: 1,
    end: totalEpisodes,
  };
  const currentStart = activePage.start;
  const currentEnd = Math.min(activePage.end, totalEpisodes);

  useEffect(() => {
    const timer = setTimeout(() => {
      const container = episodeContainerRef.current;
      const button = episodeButtonRefs.current[value];
      if (!container || !button) return;

      const containerRect = container.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const isVisible =
        buttonRect.top >= containerRect.top &&
        buttonRect.bottom <= containerRect.bottom;

      if (isVisible) return;

      const targetScrollTop =
        container.scrollTop +
        (buttonRect.top - containerRect.top) -
        container.clientHeight / 2 +
        button.clientHeight / 2;
      const maxScrollTop = container.scrollHeight - container.clientHeight;

      container.scrollTo({
        top: Math.max(0, Math.min(targetScrollTop, maxScrollTop)),
        behavior: 'smooth',
      });
      setHasEpisodeTopFade(true);
      window.setTimeout(syncEpisodeFade, 120);
    }, 80);

    return () => clearTimeout(timer);
  }, [currentPage, currentEnd, currentStart, syncEpisodeFade, value]);

  useEffect(() => {
    const timer = window.setTimeout(syncEpisodeFade, 0);
    return () => window.clearTimeout(timer);
  }, [currentPage, currentEnd, currentStart, syncEpisodeFade, value]);

  const episodeContainerStyle = hasEpisodeTopFade
    ? {
        WebkitMaskImage: hasEpisodeBottomFade
          ? 'linear-gradient(to bottom, transparent 0, #000 2rem, #000 calc(100% - 2rem), transparent 100%)'
          : 'linear-gradient(to bottom, transparent 0, #000 2rem, #000 100%)',
        maskImage: hasEpisodeBottomFade
          ? 'linear-gradient(to bottom, transparent 0, #000 2rem, #000 calc(100% - 2rem), transparent 100%)'
          : 'linear-gradient(to bottom, transparent 0, #000 2rem, #000 100%)',
      }
    : hasEpisodeBottomFade
      ? {
          WebkitMaskImage:
            'linear-gradient(to bottom, #000 0, #000 calc(100% - 2rem), transparent 100%)',
          maskImage:
            'linear-gradient(to bottom, #000 0, #000 calc(100% - 2rem), transparent 100%)',
        }
      : undefined;

  return (
    <>
      {(variantSources.length > 1 || showPagination) && (
        <div className='flex min-w-0 flex-shrink-0 flex-col gap-2 px-5 pb-2 pt-2 sm:px-6'>
          {variantSources.length > 1 && (
            <div className='flex min-w-0 flex-wrap justify-center gap-2'>
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
              className='min-w-0 overflow-x-auto'
              ref={categoryContainerRef}
              onMouseEnter={() => setIsCategoryHovered(true)}
              onMouseLeave={() => setIsCategoryHovered(false)}
            >
              <div className='flex w-max min-w-full justify-center gap-1'>
                {pages.map((page, idx) => {
                  const isActive = idx === currentPage;
                  return (
                    <button
                      key={`${page.label}-${page.start}`}
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
                      {page.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div
        ref={episodeContainerRef}
        className='flex min-w-0 flex-1 flex-wrap content-start justify-center gap-2 overflow-y-auto overflow-x-hidden px-5 pb-5 pt-2 sm:px-6 sm:pb-6'
        onScroll={syncEpisodeFade}
        style={episodeContainerStyle}
      >
        {(() => {
          const len = currentEnd - currentStart + 1;
          return Array.from({ length: len }, (_, i) => currentStart + i);
        })().map((episodeNumber) => {
          const isActive = episodeNumber === value;
          const rawTitle = episodes_titles?.[episodeNumber - 1];
          const match = rawTitle?.match(/(?:第)?(\d+)(?:集|话)/);
          const displayTitle =
            totalEpisodes === 1
              ? '正片'
              : rawTitle
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
              ref={(el) => {
                episodeButtonRefs.current[episodeNumber] = el;
              }}
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
              title={
                rawTitle ||
                (totalEpisodes === 1 ? '正片' : `第 ${episodeNumber} 集`)
              }
            >
              <span className='truncate'>{displayTitle}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};
