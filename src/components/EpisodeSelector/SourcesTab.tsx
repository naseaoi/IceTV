/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

interface SourcesTabProps {
  availableSources: SearchResult[];
  sourceSearchLoading: boolean;
  sourceSearchError: string | null;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  onSourceChange?: (source: string, id: string, title: string) => void;
  precomputedVideoInfo?: Map<string, VideoInfo>;
}

export const SourcesTab: React.FC<SourcesTabProps> = ({
  availableSources,
  sourceSearchLoading,
  sourceSearchError,
  currentSource,
  currentId,
  videoTitle,
  onSourceChange,
  precomputedVideoInfo,
}) => {
  const router = useRouter();

  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map(),
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set(),
  );
  const attemptedSourcesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;
    if (attemptedSourcesRef.current.has(sourceKey)) return;
    if (!source.episodes || source.episodes.length === 0) return;

    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

    setAttemptedSources((prev) => new Set(prev).add(sourceKey));

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl);
      setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
    } catch {
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        }),
      );
    }
  }, []);

  // 合并预计算结果
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((v, k) => newMap.set(k, v));
        return newMap;
      });
      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          if (!info.hasError) newSet.add(key);
        });
        return newSet;
      });
      precomputedVideoInfo.forEach((info, key) => {
        if (!info.hasError) attemptedSourcesRef.current.add(key);
      });
    }
  }, [precomputedVideoInfo]);

  // 异步获取视频信息
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (!optimizationEnabled || availableSources.length === 0) return;

      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });
      if (pendingSources.length === 0) return;

      const batchSize = Math.ceil(pendingSources.length / 2);
      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }
    };
    fetchVideoInfosInBatches();
  }, [availableSources, getVideoInfo, optimizationEnabled]);

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange],
  );

  if (sourceSearchLoading) {
    return (
      <div className='flex items-center justify-center py-8 flex-1'>
        <div className='animate-spin rounded-full h-7 w-7 border-2 border-green-500 border-t-transparent'></div>
        <span className='ml-2.5 text-sm text-gray-500 dark:text-gray-400'>
          搜索中...
        </span>
      </div>
    );
  }

  if (sourceSearchError) {
    return (
      <div className='flex items-center justify-center py-8 flex-1'>
        <div className='text-center'>
          <div className='text-red-400 text-2xl mb-2'>⚠️</div>
          <p className='text-sm text-red-500 dark:text-red-400'>
            {sourceSearchError}
          </p>
        </div>
      </div>
    );
  }

  if (availableSources.length === 0) {
    return (
      <div className='flex items-center justify-center py-8 flex-1'>
        <div className='text-center'>
          <div className='text-gray-300 dark:text-gray-600 text-2xl mb-2'>
            📺
          </div>
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            暂无可用的换源
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='flex-1 overflow-y-auto space-y-1 p-2 pb-20'>
      {availableSources
        .sort((a, b) => {
          const aIsCurrent =
            a.source?.toString() === currentSource?.toString() &&
            a.id?.toString() === currentId?.toString();
          const bIsCurrent =
            b.source?.toString() === currentSource?.toString() &&
            b.id?.toString() === currentId?.toString();
          if (aIsCurrent && !bIsCurrent) return -1;
          if (!aIsCurrent && bIsCurrent) return 1;
          return 0;
        })
        .map((source, index) => {
          const isCurrentSource =
            source.source?.toString() === currentSource?.toString() &&
            source.id?.toString() === currentId?.toString();
          const sourceKey = `${source.source}-${source.id}`;
          const videoInfo = videoInfoMap.get(sourceKey);

          return (
            <div
              key={sourceKey}
              onClick={() => !isCurrentSource && handleSourceClick(source)}
              className={`flex items-start gap-3 px-2.5 py-2.5 rounded-lg transition-all select-none duration-150 relative
                ${
                  isCurrentSource
                    ? 'bg-green-50 dark:bg-green-500/10 ring-1 ring-green-500/30'
                    : 'hover:bg-gray-50 dark:hover:bg-white/[0.06] cursor-pointer'
                }`.trim()}
            >
              {/* 封面 */}
              <div className='flex-shrink-0 w-11 h-[4.25rem] bg-gray-200 dark:bg-gray-700 rounded-md overflow-hidden'>
                {source.episodes && source.episodes.length > 0 && (
                  <img
                    src={processImageUrl(source.poster)}
                    alt={source.title}
                    className='w-full h-full object-cover'
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
              </div>

              {/* 信息区域 */}
              <div className='flex-1 min-w-0 flex flex-col justify-between h-[4.25rem]'>
                {/* 标题和分辨率 */}
                <div className='flex items-start justify-between gap-2'>
                  <div className='flex-1 min-w-0 relative group/title'>
                    <h3 className='font-medium text-sm truncate text-gray-900 dark:text-gray-100 leading-tight'>
                      {source.title}
                    </h3>
                    {index !== 0 && (
                      <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-[500] pointer-events-none'>
                        {source.title}
                        <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                      </div>
                    )}
                  </div>
                  {videoInfo &&
                    videoInfo.quality !== '未知' &&
                    (() => {
                      if (videoInfo.hasError) {
                        return (
                          <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400 flex-shrink-0'>
                            检测失败
                          </span>
                        );
                      }
                      const isUltraHigh = ['4K', '2K'].includes(
                        videoInfo.quality,
                      );
                      const isHigh = ['1080p', '720p'].includes(
                        videoInfo.quality,
                      );
                      const colorClasses = isUltraHigh
                        ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400'
                        : isHigh
                          ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                          : 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400';
                      return (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${colorClasses}`}
                        >
                          {videoInfo.quality}
                        </span>
                      );
                    })()}
                </div>

                {/* 源名称和集数 */}
                <div className='flex items-center justify-between'>
                  <span className='text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.08] text-gray-600 dark:text-gray-400 font-medium'>
                    {source.source_name}
                  </span>
                  {source.episodes.length > 1 && (
                    <span className='text-[11px] text-gray-400 dark:text-gray-500'>
                      {source.episodes.length} 集
                    </span>
                  )}
                </div>

                {/* 网络信息 */}
                <div className='flex items-end gap-3'>
                  {videoInfo && !videoInfo.hasError && (
                    <div className='flex items-center gap-2.5 text-[11px]'>
                      <span className='text-green-600 dark:text-green-400 font-medium'>
                        {videoInfo.loadSpeed}
                      </span>
                      <span className='text-orange-500 dark:text-orange-400 font-medium'>
                        {videoInfo.pingTime}ms
                      </span>
                    </div>
                  )}
                  {videoInfo && videoInfo.hasError && (
                    <span className='text-[11px] text-gray-400 dark:text-gray-500'>
                      无测速数据
                    </span>
                  )}
                </div>
              </div>

              {/* 当前源标记 */}
              {isCurrentSource && (
                <div className='absolute top-1.5 right-1.5'>
                  <div className='w-1.5 h-1.5 rounded-full bg-green-500'></div>
                </div>
              )}
            </div>
          );
        })}

      <div className='flex-shrink-0 mt-auto pt-2 border-t border-gray-100 dark:border-white/[0.06]'>
        <button
          onClick={() => {
            if (videoTitle) {
              router.push(`/search?q=${encodeURIComponent(videoTitle)}`);
            }
          }}
          className='w-full text-center text-xs text-gray-400 dark:text-gray-500 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
        >
          影片匹配有误？点击去搜索
        </button>
      </div>
    </div>
  );
};
