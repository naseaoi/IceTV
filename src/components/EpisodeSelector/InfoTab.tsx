/* eslint-disable @next/next/no-img-element */

import { Clapperboard, ExternalLink, Heart } from 'lucide-react';
import React from 'react';

import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

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
    <Heart className='h-5 w-5 stroke-[1.5] text-gray-500 dark:text-gray-400 hover:text-red-400 transition-colors' />
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
  return (
    <div className='flex-1 overflow-y-auto p-4 space-y-4'>
      {/* 封面 + 基本信息 */}
      <div className='flex gap-4'>
        {/* 封面 */}
        <div className='flex-shrink-0 w-28 aspect-[2/3] rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-800 ring-1 ring-black/5 dark:ring-white/10'>
          {videoCover ? (
            <img
              src={processImageUrl(videoCover)}
              alt={videoTitle}
              className='w-full h-full object-cover'
            />
          ) : (
            <div className='w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-600'>
              <Clapperboard className='w-8 h-8' />
            </div>
          )}
        </div>

        {/* 标题 + 标签 */}
        <div className='flex-1 min-w-0 flex flex-col gap-2.5'>
          {/* 标题行 + 收藏：items-center 保证垂直居中对齐 */}
          <div className='flex items-center gap-2'>
            <h3 className='text-base font-bold text-gray-900 dark:text-gray-100 leading-snug truncate min-w-0'>
              {videoTitle || '影片标题'}
            </h3>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className='flex-shrink-0 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            >
              <FavoriteIcon filled={favorited} />
            </button>
          </div>

          {/* 第一行标签：来源站、年份、集数 */}
          <div className='flex flex-wrap gap-1.5'>
            {detail?.source_name && (
              <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'>
                {detail.source_name}
              </span>
            )}
            {(detail?.year || videoYear) && (
              <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'>
                {detail?.year || videoYear}
              </span>
            )}
            {totalEpisodes > 1 && (
              <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'>
                共 {totalEpisodes} 集
              </span>
            )}
          </div>

          {/* 第二行标签：分区、标签 */}
          {(detail?.class || detail?.type_name) && (
            <div className='flex flex-wrap gap-1.5'>
              {detail?.class && (
                <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'>
                  {detail.class}
                </span>
              )}
              {detail?.type_name && (
                <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'>
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
              className='inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400 hover:underline w-fit'
            >
              <ExternalLink className='w-3 h-3' />
              豆瓣详情
            </a>
          )}
        </div>
      </div>

      {/* 简介 */}
      {detail?.desc && (
        <div>
          <h4 className='text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider'>
            简介
          </h4>
          <p
            className='text-sm leading-relaxed text-gray-600 dark:text-gray-400'
            style={{ whiteSpace: 'pre-line' }}
          >
            {detail.desc}
          </p>
        </div>
      )}
    </div>
  );
};
