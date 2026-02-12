import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface EpisodesTabProps {
  totalEpisodes: number;
  episodes_titles: string[];
  episodesPerPage: number;
  value: number;
  onChange?: (episodeNumber: number) => void;
}

export const EpisodesTab: React.FC<EpisodesTabProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage,
  value,
  onChange,
}) => {
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [descending, setDescending] = useState(false);

  const displayPage = useMemo(() => {
    return descending ? pageCount - 1 - currentPage : currentPage;
  }, [currentPage, descending, pageCount]);

  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  const categories = useMemo(() => {
    if (descending) {
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

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
    const btn = buttonRefs.current[displayPage];
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
  }, [displayPage, pageCount]);

  const handleCategoryClick = useCallback(
    (index: number) => {
      setCurrentPage(descending ? pageCount - 1 - index : index);
    },
    [descending, pageCount],
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes,
  );

  return (
    <>
      {/* 工具栏：分页标签 + 正/倒序 */}
      <div className='flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0'>
        {/* 分页标签（仅多页时显示） */}
        {pageCount > 1 && (
          <div
            className='flex-1 overflow-x-auto'
            ref={categoryContainerRef}
            onMouseEnter={() => setIsCategoryHovered(true)}
            onMouseLeave={() => setIsCategoryHovered(false)}
          >
            <div className='flex gap-1 w-max min-w-full justify-center'>
              {categories.map((label, idx) => {
                const isActive = idx === displayPage;
                return (
                  <button
                    key={label}
                    ref={(el) => {
                      buttonRefs.current[idx] = el;
                    }}
                    onClick={() => handleCategoryClick(idx)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 whitespace-nowrap
                      ${
                        isActive
                          ? 'bg-green-500 text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-gray-200'
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
        {/* 单页时显示集数范围 */}
        {pageCount <= 1 && (
          <span className='flex-1 text-xs font-medium text-gray-500 dark:text-gray-400 text-center'>
            1-{totalEpisodes}
          </span>
        )}
        {/* 正/倒序按钮（始终显示） */}
        <button
          className='flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-green-600 hover:bg-gray-100 dark:hover:bg-white/10 dark:hover:text-green-400 transition-colors'
          onClick={() => setDescending((prev) => !prev)}
          title={descending ? '切换正序' : '切换倒序'}
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${descending ? 'rotate-180' : ''}`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth='2'
              d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
            />
          </svg>
        </button>
      </div>

      {/* 集数网格 */}
      <div className='grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-2 overflow-y-auto flex-1 content-start p-4'>
        {(() => {
          const len = currentEnd - currentStart + 1;
          return Array.from({ length: len }, (_, i) =>
            descending ? currentEnd - i : currentStart + i,
          );
        })().map((episodeNumber) => {
          const isActive = episodeNumber === value;
          const rawTitle = episodes_titles?.[episodeNumber - 1];
          const match = rawTitle?.match(/(?:第)?(\d+)(?:集|话)/);
          const displayTitle = rawTitle
            ? match
              ? match[1]
              : rawTitle
            : `${episodeNumber}`;
          const isNumericLabel = /^\d+$/.test(displayTitle);
          const dynamicSpan = Math.max(
            1,
            Math.min(4, Math.ceil(displayTitle.length / 4)),
          );
          return (
            <button
              key={episodeNumber}
              onClick={() => onChange?.(episodeNumber - 1)}
              style={
                isNumericLabel
                  ? undefined
                  : {
                      gridColumn: `span ${dynamicSpan} / span ${dynamicSpan}`,
                    }
              }
              className={`h-11 ${isNumericLabel ? 'px-0' : 'px-3'} flex items-center justify-center text-[13px] font-semibold rounded-lg transition-all duration-150 whitespace-nowrap ${isNumericLabel ? 'font-mono' : 'font-medium'}
                ${
                  isActive
                    ? 'bg-green-500 text-white shadow-md shadow-green-500/20'
                    : 'bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/[0.12] hover:scale-105'
                }`.trim()}
              title={rawTitle || `第 ${episodeNumber} 集`}
            >
              {displayTitle}
            </button>
          );
        })}
      </div>
    </>
  );
};
