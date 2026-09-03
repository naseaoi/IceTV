import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { AddSourcesModal } from '@/features/play/components/EpisodeSelector/AddSourcesModal';
import { resolveSourceProbeEpisodeIndex } from '@/features/play/lib/sourceProbePolicy';
import {
  type ProbeEntry,
  type VideoInfo,
  getOrProbe,
  getSnapshot,
  seedProbeResults,
  subscribe,
} from '@/features/play/lib/sourceProbeStore';
import { readEnableOptimization } from '@/lib/local-preferences';
import { collapseSourcesForDisplay } from '@/lib/source-bundle';
import { normalizeTitleForSourceMatch } from '@/lib/source-match';
import { SearchResult } from '@/lib/types';

export const VIDEO_INFO_BATCH_SIZE = 4;

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
  return entry.source === 'pending' || entry.source === 'queued'
    ? entry.previousInfo
    : entry.info;
}

export function isActivelyProbing(entry: ProbeEntry | undefined): boolean {
  return entry?.source === 'pending';
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
      };
    })
    .sort((a, b) => {
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

  const currentItemRef = useRef<HTMLButtonElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const userScrollingRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScrollTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [isCurrentInView, setIsCurrentInView] = useState(true);

  const [_optimizationEnabled] = useState<boolean>(() => {
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
  const [showAddSourcesModal, setShowAddSourcesModal] = useState(false);
  const [searchCandidates, setSearchCandidates] = useState<SearchResult[]>([]);

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
  }, [
    displaySources,
    currentSource,
    currentId,
    probeSnapshot,
    probeSourcesInBatches,
  ]);

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange],
  );

  const sortedSources = useMemo(() => {
    return sortSourcesForDisplay(displaySources, probeSnapshot);
  }, [displaySources, probeSnapshot]);

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
      <div className='flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-gray-500 dark:text-gray-400'>
        <div className='h-5 w-5 animate-spin rounded-full border-2 border-green-500 border-t-transparent' />
        <span className='ml-2.5'>搜索中...</span>
      </div>
    );
  }

  if (sourceSearchError) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center p-6'>
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
      <div className='flex min-h-0 flex-1 items-center justify-center p-6'>
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
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4 sm:px-6'>
      <div className='flex flex-shrink-0 items-center justify-between'>
        <h3 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
          源站列表
        </h3>
        <div className='flex gap-2'>
          <button
            type='button'
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
            className='rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          >
            {isRetestingAll ? '检测中...' : '检测全部'}
          </button>
          <button
            type='button'
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
                  const normalizedTitle = normalizeTitleForSourceMatch(
                    videoTitle || '',
                  );
                  const filtered = (data.results as SearchResult[]).filter(
                    (s) => {
                      if (!normalizedTitle) return true;
                      const t = normalizeTitleForSourceMatch(s.title);
                      return t.length > 0 && t === normalizedTitle;
                    },
                  );

                  if (filtered.length > 0) {
                    setSearchCandidates(filtered);
                    setShowAddSourcesModal(true);
                  } else {
                    setSearchMoreDone(true);
                  }
                }
              } catch {
                setSearchMoreDone(false);
              } finally {
                setIsSearchingMore(false);
              }
            }}
            className='rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          >
            {isSearchingMore
              ? '搜索中...'
              : searchMoreDone
                ? '搜索完成'
                : '搜索更多源站'}
          </button>
        </div>
      </div>

      <div className='relative flex min-h-0 flex-1 flex-col'>
        <div
          ref={listContainerRef}
          className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto'
        >
          {sortedSources.map((source) => {
            const isCurrentSource =
              source.source?.toString() === currentSource?.toString() &&
              source.id?.toString() === currentId?.toString();
            const sourceKey = `${source.source}-${source.id}`;
            const probeEntry = probeSnapshot.get(sourceKey);
            const isTesting = isActivelyProbing(probeEntry);
            const videoInfo = isTesting
              ? probeEntry?.info
              : getCompletedProbeInfo(probeEntry);
            const episodeCount = Math.max(
              source.episodes.length,
              source.episodes_titles?.length || 0,
            );

            return (
              <button
                key={sourceKey}
                ref={isCurrentSource ? currentItemRef : null}
                type='button'
                onClick={() => {
                  if (!isCurrentSource) {
                    handleSourceClick(source);
                  }
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  isCurrentSource
                    ? 'border-green-500/60 bg-green-500/10'
                    : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700'
                }`}
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {source.title}
                    </div>
                    <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400'>
                      <span>{source.source_name}</span>
                      {episodeCount > 1 && <span>{episodeCount} 集</span>}
                      {videoInfo &&
                        !videoInfo.hasError &&
                        videoInfo.quality !== '未知' && (
                          <span className='text-green-600 dark:text-green-400'>
                            {videoInfo.quality}
                          </span>
                        )}
                      {videoInfo &&
                        !videoInfo.hasError &&
                        videoInfo.loadSpeed !== '未知' &&
                        videoInfo.loadSpeed !== '测量中...' && (
                          <span className='text-green-600 dark:text-green-400'>
                            {videoInfo.loadSpeed}
                          </span>
                        )}
                      {videoInfo &&
                        !videoInfo.hasError &&
                        Number.isFinite(videoInfo.pingTime) && (
                          <span className='text-orange-500 dark:text-orange-400'>
                            {videoInfo.pingTime}ms
                          </span>
                        )}
                      {isTesting && (
                        <span className='flex items-center gap-1'>
                          <span className='inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-gray-300 border-t-green-500 dark:border-gray-600 dark:border-t-green-400' />
                          检测中
                        </span>
                      )}
                      {videoInfo && videoInfo.hasError && (
                        <span
                          className='cursor-pointer text-blue-500 hover:underline dark:text-blue-400'
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
                          重试
                        </span>
                      )}
                    </div>
                  </div>
                  {isCurrentSource && (
                    <div className='flex-shrink-0 pt-0.5'>
                      <div className='h-2 w-2 rounded-full bg-green-500' />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
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
            className='absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-all hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-500'
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

      {showAddSourcesModal && (
        <AddSourcesModal
          candidates={searchCandidates}
          existingKeys={
            new Set(availableSources.map((s) => `${s.source}-${s.id}`))
          }
          currentEpisodeCount={
            activeDetail
              ? Math.max(
                  activeDetail.episodes.length,
                  activeDetail.episodes_titles?.length || 0,
                )
              : undefined
          }
          onConfirm={async (selected) => {
            setShowAddSourcesModal(false);
            if (selected.length > 0) {
              onAddSources?.(selected);
              await probeSourcesInBatches(selected);
            }
            setSearchMoreDone(true);
          }}
          onCancel={() => {
            setShowAddSourcesModal(false);
            setSearchMoreDone(true);
          }}
        />
      )}
    </div>
  );
};
