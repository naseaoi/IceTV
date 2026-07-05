import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  getSourceFailure,
  type SourceFailureInfo,
} from '@/lib/failed-source-cooldown';
import { readEnableOptimization } from '@/lib/local-preferences';
import { collapseSourcesForDisplay } from '@/lib/source-bundle';
import { normalizeTitleForSourceMatch } from '@/lib/source-match';
import { SearchResult } from '@/lib/types';

import { resolveSourceProbeEpisodeIndex } from '@/features/play/lib/sourceProbePolicy';
import {
  getOrProbe,
  getSnapshot,
  seedProbeResults,
  subscribe,
  type ProbeEntry,
  type VideoInfo,
} from '@/features/play/lib/sourceProbeStore';

const VIDEO_INFO_BATCH_SIZE = 3;

interface SourcesTabProps {
  availableSources: SearchResult[];
  sourceSearchLoading: boolean;
  sourceSearchError: string | null;
  isActive?: boolean;
  currentSource?: string;
  currentId?: string;
  currentEpisodeIndex?: number;
  videoTitle?: string;
  searchKeyword?: string;
  onSourceChange?: (source: string, id: string, title: string) => void;
  precomputedVideoInfo?: Map<string, VideoInfo>;
  activeDetail?: SearchResult | null;
  onSourceDetailFetched?: (updated: SearchResult) => void;
  onAddSources?: (newSources: SearchResult[]) => void;
}

export function getCompletedProbeInfo(
  entry: ProbeEntry | undefined,
): VideoInfo | undefined {
  if (!entry) return undefined;
  return entry.source === 'pending' ? entry.previousInfo : entry.info;
}

const isSortingReadyVideoInfo = (videoInfo?: VideoInfo): boolean => {
  if (!videoInfo || videoInfo.hasError) return false;
  return (
    videoInfo.loadSpeed !== '测量中...' &&
    videoInfo.loadSpeed !== '未知' &&
    videoInfo.loadSpeed !== '播放中'
  );
};

const getSortStatusRank = (videoInfo?: VideoInfo): number => {
  if (isSortingReadyVideoInfo(videoInfo)) {
    return 0;
  }
  if (videoInfo?.hasError) {
    return 2;
  }
  return 1;
};

const parseSpeedToKBps = (loadSpeed?: string): number => {
  if (!loadSpeed || loadSpeed === '未知' || loadSpeed === '测量中...') {
    return 0;
  }

  const match = loadSpeed.match(/^([\d.]+)\s*(Mbps|Mb\/s|KB\/s|MB\/s)$/);
  if (!match) {
    return 0;
  }

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const unit = match[2];
  if (unit === 'Mbps' || unit === 'Mb/s') {
    return (value * 1024) / 8;
  }
  if (unit === 'MB/s') {
    return value * 1024;
  }
  return value;
};

const getQualityRank = (quality?: string): number => {
  if (!quality || quality === '未知' || quality === '错误') {
    return 0;
  }

  const normalized = quality.toUpperCase();
  if (normalized.includes('4K') || normalized.includes('2160')) {
    return 5;
  }
  if (normalized.includes('2K') || normalized.includes('1440')) {
    return 4;
  }
  if (normalized.includes('1080')) {
    return 3;
  }
  if (normalized.includes('720')) {
    return 2;
  }
  if (normalized.includes('480')) {
    return 1;
  }
  return 0;
};

export function sortSourcesForDisplay(
  displaySources: SearchResult[],
  probeSnapshot: ReadonlyMap<string, ProbeEntry>,
  sourceFailures: ReadonlyMap<string, SourceFailureInfo>,
): SearchResult[] {
  return displaySources
    .map((source, index) => {
      const sourceKey = `${source.source}-${source.id}`;
      const entry = probeSnapshot.get(sourceKey);
      const videoInfo = getCompletedProbeInfo(entry);
      const hasMeasuredInfo = isSortingReadyVideoInfo(videoInfo);
      const measuredVideoInfo = hasMeasuredInfo ? videoInfo : undefined;

      return {
        source,
        index,
        sortStatusRank: getSortStatusRank(videoInfo),
        qualityRank: measuredVideoInfo
          ? getQualityRank(measuredVideoInfo.quality)
          : 0,
        speedKBps: measuredVideoInfo
          ? parseSpeedToKBps(measuredVideoInfo.loadSpeed)
          : 0,
        pingTime:
          measuredVideoInfo && Number.isFinite(measuredVideoInfo.pingTime)
            ? measuredVideoInfo.pingTime
            : Number.MAX_SAFE_INTEGER,
        hasMeasuredInfo,
        coolingDown: sourceFailures.has(sourceKey),
      };
    })
    .sort((a, b) => {
      if (a.coolingDown !== b.coolingDown) {
        return a.coolingDown ? 1 : -1;
      }
      if (a.sortStatusRank !== b.sortStatusRank) {
        return a.sortStatusRank - b.sortStatusRank;
      }
      if (a.hasMeasuredInfo && b.hasMeasuredInfo) {
        if (a.speedKBps !== b.speedKBps) {
          return b.speedKBps - a.speedKBps;
        }
        if (a.pingTime !== b.pingTime) {
          return a.pingTime - b.pingTime;
        }
        if (a.qualityRank !== b.qualityRank) {
          return b.qualityRank - a.qualityRank;
        }
      }
      return a.index - b.index;
    })
    .map((item) => item.source);
}

export const SourcesTab: React.FC<SourcesTabProps> = ({
  availableSources,
  sourceSearchLoading,
  sourceSearchError,
  isActive = false,
  currentSource,
  currentId,
  currentEpisodeIndex = 0,
  videoTitle,
  searchKeyword,
  onSourceChange,
  precomputedVideoInfo,
  activeDetail = null,
  onSourceDetailFetched,
  onAddSources,
}) => {
  const probeSnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  const currentItemRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const userScrollingRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScrollTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [isCurrentInView, setIsCurrentInView] = useState(true);

  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    return readEnableOptimization();
  });

  const displaySources = useMemo(
    () => collapseSourcesForDisplay(availableSources, currentSource, currentId),
    [availableSources, currentSource, currentId],
  );

  const [isSearchingMore, setIsSearchingMore] = useState(false);
  const [searchMoreDone, setSearchMoreDone] = useState(false);
  const [isRetestingAll, setIsRetestingAll] = useState(false);

  useEffect(() => {
    if (!precomputedVideoInfo || precomputedVideoInfo.size === 0) return;
    seedProbeResults(precomputedVideoInfo.entries());
  }, [precomputedVideoInfo]);

  const probeSourcesInBatches = useCallback(
    async (sources: SearchResult[], options?: { force?: boolean }) => {
      for (
        let start = 0;
        start < sources.length;
        start += VIDEO_INFO_BATCH_SIZE
      ) {
        const batch = sources.slice(start, start + VIDEO_INFO_BATCH_SIZE);
        await Promise.all(
          batch.map((source) =>
            getOrProbe(source, {
              force: options?.force,
              episodeIndex: resolveSourceProbeEpisodeIndex({
                activeDetail,
                currentEpisodeIndex,
                targetSource: source,
              }),
              onDetailFetched: onSourceDetailFetched,
            }),
          ),
        );
      }
    },
    [activeDetail, currentEpisodeIndex, onSourceDetailFetched],
  );

  useEffect(() => {
    if (displaySources.length === 0) return;
    const currentKey =
      currentSource && currentId ? `${currentSource}-${currentId}` : '';
    const pending = displaySources.filter((s) => {
      const key = `${s.source}-${s.id}`;
      if (key === currentKey) return false;
      const entry = probeSnapshot.get(key);
      if (!entry) return true;
      if (entry.info.hasError) return false;
      return false;
    });
    if (pending.length === 0) return;
    void probeSourcesInBatches(pending);
  }, [displaySources, currentSource, currentId, probeSourcesInBatches]);

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange],
  );

  const sourceFailures = useMemo(() => {
    const map = new Map<string, SourceFailureInfo>();
    for (const source of displaySources) {
      const key = `${source.source}-${source.id}`;
      const failure = getSourceFailure(key);
      if (failure.coolingDown) {
        map.set(key, failure);
      }
    }
    return map;
  }, [displaySources, isActive]);

  const sortedSources = useMemo(() => {
    return sortSourcesForDisplay(displaySources, probeSnapshot, sourceFailures);
  }, [displaySources, probeSnapshot, sourceFailures]);

  const scrollCurrentIntoView = useCallback((smooth = true) => {
    const listContainer = listContainerRef.current;
    const currentItem = currentItemRef.current;
    if (!listContainer || !currentItem) return;

    requestAnimationFrame(() => {
      const containerRect = listContainer.getBoundingClientRect();
      const itemRect = currentItem.getBoundingClientRect();
      const targetScrollTop =
        listContainer.scrollTop +
        (itemRect.top - containerRect.top) -
        listContainer.clientHeight / 2 +
        currentItem.clientHeight / 2;

      const maxScrollTop =
        listContainer.scrollHeight - listContainer.clientHeight;
      const nextScrollTop = Math.max(
        0,
        Math.min(targetScrollTop, maxScrollTop),
      );

      programmaticScrollRef.current = true;
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
      programmaticScrollTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 800);

      listContainer.scrollTo({
        top: nextScrollTop,
        behavior: smooth ? 'smooth' : 'auto',
      });
    });
  }, []);

  useEffect(() => {
    if (!isActive) return;
    userScrollingRef.current = false;
    if (userScrollTimerRef.current) {
      clearTimeout(userScrollTimerRef.current);
      userScrollTimerRef.current = null;
    }
    scrollCurrentIntoView(true);
  }, [isActive, currentSource, currentId, scrollCurrentIntoView]);

  useEffect(() => {
    const listContainer = listContainerRef.current;
    if (!listContainer) return;

    const handleScroll = () => {
      if (!programmaticScrollRef.current) {
        userScrollingRef.current = true;
        if (userScrollTimerRef.current) {
          clearTimeout(userScrollTimerRef.current);
        }
        userScrollTimerRef.current = setTimeout(() => {
          userScrollingRef.current = false;
        }, 2000);
      }

      const currentItem = currentItemRef.current;
      if (!currentItem) {
        setIsCurrentInView(true);
        return;
      }
      const containerRect = listContainer.getBoundingClientRect();
      const itemRect = currentItem.getBoundingClientRect();
      const inView =
        itemRect.bottom > containerRect.top &&
        itemRect.top < containerRect.bottom;
      setIsCurrentInView(inView);
    };

    listContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      listContainer.removeEventListener('scroll', handleScroll);
    };
  }, [sortedSources.length]);

  useEffect(() => {
    return () => {
      if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
    };
  }, []);

  if (sourceSearchLoading) {
    return (
      <div className='flex flex-1 items-center justify-center py-8'>
        <div className='h-7 w-7 animate-spin rounded-full border-2 border-green-500 border-t-transparent'></div>
        <span className='ml-2.5 text-sm text-gray-500 dark:text-gray-400'>
          搜索中...
        </span>
      </div>
    );
  }

  if (sourceSearchError) {
    return (
      <div className='flex flex-1 items-center justify-center py-8'>
        <div className='text-center'>
          <div className='mb-2 text-2xl text-red-400'>⚠️</div>
          <p className='text-sm text-red-500 dark:text-red-400'>
            {sourceSearchError}
          </p>
        </div>
      </div>
    );
  }

  if (displaySources.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center py-8'>
        <div className='text-center'>
          <div className='mb-2 text-2xl text-gray-300 dark:text-gray-600'>
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
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <div ref={listContainerRef} className='flex-1 overflow-y-auto p-5 sm:p-6'>
        <div className='grid grid-cols-1 gap-2'>
          {sortedSources.map((source, index) => {
            const isCurrentSource =
              source.source?.toString() === currentSource?.toString() &&
              source.id?.toString() === currentId?.toString();
            const sourceKey = `${source.source}-${source.id}`;
            const videoInfo = probeSnapshot.get(sourceKey)?.info;
            const isTesting = videoInfo?.loadSpeed === '测量中...';
            const failureInfo = sourceFailures.get(sourceKey);
            const isCoolingDown = !!failureInfo;
            const failureLabel = failureInfo?.label || '近期失败';
            const failureTitle = failureInfo
              ? `${failureLabel}${failureInfo.count > 1 ? ` · ${failureInfo.count}次` : ''}`
              : undefined;
            const episodeCount = Math.max(
              source.episodes.length,
              source.episodes_titles?.length || 0,
            );

            return (
              <div
                key={sourceKey}
                ref={isCurrentSource ? currentItemRef : null}
                onClick={() => {
                  if (!isCurrentSource) {
                    handleSourceClick(source);
                  }
                }}
                className={`relative grid select-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 transition-all duration-150
                  ${
                    isCurrentSource
                      ? 'bg-green-50 ring-1 ring-green-500/30 dark:bg-green-500/10'
                      : isCoolingDown
                        ? 'cursor-pointer bg-gray-50/80 opacity-60 ring-1 ring-gray-200/60 hover:bg-gray-100/80 hover:opacity-100 hover:ring-gray-300/60 dark:bg-white/[0.04] dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:ring-white/[0.1]'
                        : 'cursor-pointer bg-gray-50/80 ring-1 ring-gray-200/60 hover:bg-gray-100/80 hover:ring-gray-300/60 dark:bg-white/[0.04] dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:ring-white/[0.1]'
                  }`.trim()}
                title={failureTitle}
              >
                <div className='contents'>
                  <div className='group/title relative min-w-0 flex-1'>
                    <h3 className='truncate text-xs font-medium leading-tight text-gray-900 dark:text-gray-100'>
                      {source.title}
                    </h3>
                    {index !== 0 && (
                      <div className='pointer-events-none invisible absolute bottom-full left-1/2 z-[500] mb-2 -translate-x-1/2 transform whitespace-nowrap rounded-md bg-gray-800 px-3 py-1 text-xs text-white opacity-0 shadow-lg transition-all delay-100 duration-200 ease-out group-hover/title:visible group-hover/title:opacity-100'>
                        {source.title}
                        <div className='absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 transform border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                      </div>
                    )}
                  </div>
                  {videoInfo && videoInfo.quality !== '未知' ? (
                    videoInfo.hasError ? (
                      <span className='inline-flex w-fit justify-self-end whitespace-nowrap rounded bg-red-50 px-1 py-0.5 text-[9px] font-medium text-red-500 dark:bg-red-900/20 dark:text-red-400'>
                        失败
                      </span>
                    ) : (
                      (() => {
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
                            className={`inline-flex w-fit justify-self-end whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-semibold ${colorClasses}`}
                          >
                            {videoInfo.quality}
                          </span>
                        );
                      })()
                    )
                  ) : optimizationEnabled ? (
                    <span className='inline-flex w-fit justify-self-end whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-medium text-transparent'>
                      --
                    </span>
                  ) : null}
                </div>

                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-400'>
                    {source.source_name}
                  </span>
                  {isCoolingDown ? (
                    <span className='flex-shrink-0 text-[10px] font-medium text-red-400 dark:text-red-400/80'>
                      {failureLabel}
                    </span>
                  ) : (
                    episodeCount > 1 && (
                      <span className='flex-shrink-0 text-[10px] text-gray-400 dark:text-gray-500'>
                        {episodeCount}集
                      </span>
                    )
                  )}
                </div>

                <div className='flex min-h-[16px] items-center justify-end gap-2 text-right'>
                  {videoInfo && isTesting ? (
                    <div className='flex items-center gap-1.5 text-[10px] font-medium text-gray-500 dark:text-gray-400'>
                      <span className='inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-green-500 dark:border-gray-700 dark:border-t-green-400' />
                      检测中
                    </div>
                  ) : videoInfo && !videoInfo.hasError ? (
                    <div className='flex items-center gap-1.5 text-[10px]'>
                      <span className='font-medium text-green-600 dark:text-green-400'>
                        {videoInfo.loadSpeed}
                      </span>
                      <span className='font-medium text-orange-500 dark:text-orange-400'>
                        {videoInfo.pingTime}ms
                      </span>
                    </div>
                  ) : videoInfo && videoInfo.hasError ? (
                    <span
                      className='cursor-pointer text-[10px] text-blue-400 hover:underline dark:text-blue-400'
                      onClick={(e) => {
                        e.stopPropagation();
                        void getOrProbe(source, {
                          force: true,
                          episodeIndex: resolveSourceProbeEpisodeIndex({
                            activeDetail,
                            currentEpisodeIndex,
                            targetSource: source,
                          }),
                          onDetailFetched: onSourceDetailFetched,
                        });
                      }}
                    >
                      {videoInfo.quality === '错误'
                        ? '检测失败 · 重试'
                        : '开始测速'}
                    </span>
                  ) : optimizationEnabled ? (
                    <div className='flex items-center gap-1.5 text-[10px]'>
                      <span className='font-medium text-gray-300 dark:text-gray-600'>
                        --
                      </span>
                      <span className='font-medium text-gray-300 dark:text-gray-600'>
                        --
                      </span>
                    </div>
                  ) : null}
                </div>

                {isCurrentSource && (
                  <div className='absolute bottom-1.5 right-1.5'>
                    <div className='h-1.5 w-1.5 rounded-full bg-green-500'></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className='flex-shrink-0 px-5 pb-5 sm:px-6 sm:pb-6'>
        <div className='mb-3 h-px rounded-full bg-gradient-to-r from-transparent via-gray-200/90 to-transparent dark:via-white/[0.12]' />
        <div className='flex gap-2'>
          <button
            disabled={isRetestingAll}
            onClick={async () => {
              setIsRetestingAll(true);
              const curKey =
                currentSource && currentId
                  ? `${currentSource}-${currentId}`
                  : '';
              const toTest = displaySources.filter((s) => {
                const key = `${s.source}-${s.id}`;
                return key !== curKey;
              });
              await probeSourcesInBatches(toTest, { force: true });
              setIsRetestingAll(false);
            }}
            className='flex-1 rounded-lg py-2 text-center text-xs font-medium text-gray-500 ring-1 ring-gray-200/60 transition-colors hover:text-green-600 hover:ring-green-300 disabled:opacity-50 dark:text-gray-400 dark:ring-white/[0.08] dark:hover:text-green-400 dark:hover:ring-green-500/30'
          >
            {isRetestingAll ? '检测中...' : '检测全部'}
          </button>
          <button
            disabled={isSearchingMore}
            onClick={async () => {
              if (!videoTitle) return;
              setIsSearchingMore(true);
              setSearchMoreDone(false);
              try {
                const query = searchKeyword || videoTitle;
                const res = await fetch(
                  `/api/search?q=${encodeURIComponent(query.trim())}`,
                );
                if (!res.ok) throw new Error('搜索失败');
                const data = await res.json();
                if (Array.isArray(data.results)) {
                  const existingKeys = new Set(
                    availableSources.map((s) => `${s.source}-${s.id}`),
                  );
                  const normalizedTitle = normalizeTitleForSourceMatch(
                    videoTitle || '',
                  );
                  const newSources = (data.results as SearchResult[]).filter(
                    (s) => {
                      if (existingKeys.has(`${s.source}-${s.id}`)) return false;
                      if (!normalizedTitle) return true;
                      const t = normalizeTitleForSourceMatch(s.title);
                      return t.length > 0 && t === normalizedTitle;
                    },
                  );
                  if (newSources.length > 0) {
                    onAddSources?.(newSources);
                  }
                  setSearchMoreDone(true);
                }
              } catch {
                setSearchMoreDone(false);
              } finally {
                setIsSearchingMore(false);
              }
            }}
            className='flex-1 rounded-lg py-2 text-center text-xs font-medium text-gray-500 ring-1 ring-gray-200/60 transition-colors hover:text-green-600 hover:ring-green-300 disabled:opacity-50 dark:text-gray-400 dark:ring-white/[0.08] dark:hover:text-green-400 dark:hover:ring-green-500/30'
          >
            {isSearchingMore
              ? '搜索中...'
              : searchMoreDone
                ? '搜索完成'
                : '搜索更多源站'}
          </button>
        </div>
      </div>
      {!isCurrentInView && currentSource && currentId && (
        <button
          type='button'
          onClick={() => {
            userScrollingRef.current = false;
            if (userScrollTimerRef.current) {
              clearTimeout(userScrollTimerRef.current);
              userScrollTimerRef.current = null;
            }
            scrollCurrentIntoView(true);
          }}
          className='absolute bottom-28 right-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-all hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-500'
          aria-label='回到当前源'
          title='回到当前源'
        >
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='18'
            height='18'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <circle cx='12' cy='12' r='8' />
            <circle cx='12' cy='12' r='2.5' />
            <line x1='12' y1='2' x2='12' y2='5' />
            <line x1='12' y1='19' x2='12' y2='22' />
            <line x1='2' y1='12' x2='5' y2='12' />
            <line x1='19' y1='12' x2='22' y2='12' />
          </svg>
        </button>
      )}
    </div>
  );
};
