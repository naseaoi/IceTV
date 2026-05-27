import { ExternalLink, Heart } from 'lucide-react';
import React, { useMemo } from 'react';

import CoverImage from '@/components/CoverImage';
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
}

const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg className='h-5 w-5' viewBox='0 0 24 24'>
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444'
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-5 w-5 stroke-[1.5] text-gray-500 transition-colors hover:text-red-400 dark:text-gray-400' />
  );
};

export const InfoTab: React.FC<InfoTabProps> = ({
  videoTitle,
  totalEpisodes,
  detail,
  videoYear,
  favorited,
  onToggleFavorite,
  videoCover,
  videoDoubanId,
}) => {
  const formattedDesc = useMemo(() => {
    const raw = detail?.desc;
    if (!raw) return '';

    const paragraphs = raw
      .split(/\r?\n+|\s{3,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    return paragraphs.map((p) => `　　${p}`).join('\n');
  }, [detail?.desc]);

  return (
    <div className='flex-1 space-y-5 overflow-y-auto p-5 sm:p-6'>
      {/* 封面 + 基本信息 */}
      <div className='flex gap-5'>
        {/* 封面 */}
        <div className='relative aspect-[2/3] w-28 flex-shrink-0 overflow-hidden rounded-xl bg-gray-200 shadow-md shadow-black/10 ring-1 ring-black/10 dark:bg-gray-800 dark:shadow-black/30 dark:ring-white/10'>
          <CoverImage
            src={videoCover}
            alt={videoTitle}
            sizes='112px'
            enableRetry={false}
          />
        </div>

        {/* 标题 + 标签：紧凑排列，垂直居中对齐封面 */}
        <div className='flex min-w-0 flex-1 flex-col justify-center gap-2.5'>
          {/* 标题 + 收藏 */}
          <div className='flex items-center gap-2'>
            <h3 className='min-w-0 truncate text-base font-bold leading-snug text-gray-900 dark:text-gray-100'>
              {videoTitle || '影片标题'}
            </h3>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className='flex-shrink-0 rounded-full p-1.5 transition-colors hover:bg-red-50 active:scale-90 dark:hover:bg-red-900/20'
            >
              <FavoriteIcon filled={favorited} />
            </button>
          </div>

          {/* 第一行标签：来源、年份、集数 */}
          <div className='flex flex-wrap gap-1.5'>
            {detail?.source_name && (
              <span className='inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-500/20'>
                {detail.source_name}
              </span>
            )}
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

          {/* 第二行标签：分区、类型 */}
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

          {/* 豆瓣链接 */}
          {videoDoubanId !== 0 && (
            <a
              href={`https://movie.douban.com/subject/${videoDoubanId}`}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex w-fit items-center gap-1 text-[11px] font-medium text-emerald-600 transition-colors hover:text-emerald-700 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300'
            >
              <ExternalLink className='h-3 w-3' />
              豆瓣详情
            </a>
          )}
        </div>
      </div>

      {/* 简介 */}
      {detail?.desc && (
        <div className='pt-2'>
          <div className='mb-3 flex items-center gap-2'>
            <div className='h-4 w-[3px] rounded-full bg-emerald-500/70 dark:bg-emerald-400/60' />
            <h4 className='text-sm font-semibold text-gray-700 dark:text-gray-300'>
              简介
            </h4>
          </div>
          <p
            className='text-[13px] leading-[1.8] text-gray-600 dark:text-gray-400'
            style={{ whiteSpace: 'pre-line' }}
          >
            {formattedDesc}
          </p>
        </div>
      )}
    </div>
  );
};
