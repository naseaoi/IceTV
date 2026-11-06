import {
  AlertCircle,
  LocateFixed,
  Plus,
  RefreshCw,
  SearchX,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { FLOATING_CONTROL_CLASS } from '@/components/floating-control';
import { PLAYER_PANEL_INSET_CLASS } from '@/components/PlayerPanelTabBar';
import Spinner from '@/components/Spinner';
import { AddSourcesModal } from '@/features/play/components/EpisodeSelector/AddSourcesModal';
import { PanelActionButton } from '@/features/play/components/EpisodeSelector/PanelActionButton';
import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';
import { parseLoadSpeedKBps } from '@/features/play/lib/autoSourceSwitchPolicy';
import { resolveSourceProbeEpisodeIndex } from '@/features/play/lib/sourceProbePolicy';
import { SOURCE_PROBE_CONCURRENCY } from '@/features/play/lib/sourceProbeRequestPolicy';
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
import { normalizeWorkTitle } from '@/lib/source-match';
import {
  type SourcePlaybackStat,
  compareSourcePlaybackPreference,
  readSourcePlaybackStats,
} from '@/lib/source-playback-stats';
import { SearchResult } from '@/lib/types';

export const VIDEO_INFO_BATCH_SIZE = SOURCE_PROBE_CONCURRENCY;

// 起播耗时的三档提示色，仅用于列表圆点
const PING_GOOD_MS = 1500;
const PING_FAIR_MS = 4000;

// 对数刻度：64 KB/s 起步、16 MB/s 满格，避免缓存命中的离群高速把其他源压成空条
const SPEED_BAR_MIN_KBPS = 64;
const SPEED_BAR_MAX_KBPS = 16 * 1024;

function speedBarRatio(kbps: number): number {
  if (kbps <= 0) return 0;
  const ratio =
    Math.log(kbps / SPEED_BAR_MIN_KBPS) /
    Math.log(SPEED_BAR_MAX_KBPS / SPEED_BAR_MIN_KBPS);
  return Math.min(1, Math.max(0.04, ratio));
}

function pingDotClass(pingTime: number): string {
  if (pingTime <= PING_GOOD_MS) return 'bg-emerald-500';
  if (pingTime <= PING_FAIR_MS) return 'bg-amber-500';
  return 'bg-red-500';
}

function SourcesTabMessage({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center'>
      {icon}
      <p className='text-[13px] text-gray-500 dark:text-gray-400'>{text}</p>
    </div>
  );
}

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
  return entry.source === 'pending' ||
    entry.source === 'queued' ||
    entry.source === 'deferred'
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
  playbackStats: ReadonlyMap<string, SourcePlaybackStat> = new Map(),
): SearchResult[] {
  const now = Date.now();
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
        playbackStat: playbackStats.get(source.source),
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
      // 测速结果分不出先后时，按历史起播表现把常用可靠源排在前面
      return (
        compareSourcePlaybackPreference(a.playbackStat, b.playbackStat, now) ||
        a.index - b.index
      );
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
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);
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
        if (!isActiveRef.current) break;
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
    if (!isActive || displaySources.length === 0) return;
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
    isActive,
  ]);

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange],
  );

  const sortedSources = useMemo(() => {
    return sortSourcesForDisplay(
      displaySources,
      probeSnapshot,
      readSourcePlaybackStats(),
    );
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
      <SourcesTabMessage
        icon={<Spinner className='h-5 w-5 text-gray-400' />}
        text='搜索中...'
      />
    );
  }

  if (sourceSearchError) {
    return (
      <SourcesTabMessage
        icon={<AlertCircle className='h-6 w-6 text-red-400' />}
        text={sourceSearchError}
      />
    );
  }

  if (displaySources.length === 0) {
    return (
      <SourcesTabMessage
        icon={<SearchX className='h-6 w-6 text-gray-300 dark:text-gray-600' />}
        text='暂无可用的换源'
      />
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className={`flex-shrink-0 pb-1 pt-3 ${PLAYER_PANEL_INSET_CLASS}`}>
        <SectionTitle as='h3' label='播放源'>
          <PanelActionButton
            busy={isRetestingAll}
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
          >
            <RefreshCw className='h-3.5 w-3.5' />
            检测全部
          </PanelActionButton>
          <PanelActionButton
            busy={isSearchingMore}
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
                  const normalizedTitle = normalizeWorkTitle(videoTitle || '');
                  const filtered = (data.results as SearchResult[]).filter(
                    (s) => {
                      if (!normalizedTitle) return true;
                      const t = normalizeWorkTitle(s.title);
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
          >
            <Plus className='h-3.5 w-3.5' />
            {searchMoreDone ? '搜索完成' : '搜索更多源站'}
          </PanelActionButton>
        </SectionTitle>
      </div>

      <div className='relative flex min-h-0 flex-1 flex-col'>
        <div
          ref={listContainerRef}
          className='flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3'
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
            const quality = videoInfo?.hasError
              ? ''
              : videoInfo?.quality?.trim();
            const resolution =
              quality &&
              quality !== '错误' &&
              quality !== '未知' &&
              quality !== 'MP4'
                ? quality
                : '';
            const episodeCount = Math.max(
              source.episodes.length,
              source.episodes_titles?.length || 0,
            );
            const showTitle =
              !!source.title &&
              normalizeWorkTitle(source.title) !==
                normalizeWorkTitle(videoTitle || '');
            const isDeferred = probeEntry?.source === 'deferred';
            const hasError = !!videoInfo?.hasError;
            const speed =
              videoInfo &&
              !hasError &&
              videoInfo.loadSpeed !== '未知' &&
              videoInfo.loadSpeed !== '测量中...'
                ? videoInfo.loadSpeed
                : '';
            const pingTime =
              videoInfo &&
              !isTesting &&
              !hasError &&
              Number.isFinite(videoInfo.pingTime)
                ? videoInfo.pingTime
                : null;
            const details = [
              showTitle ? source.title : '',
              episodeCount > 1 ? `${episodeCount} 集` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            const speedRatio = speed
              ? speedBarRatio(parseLoadSpeedKBps(speed))
              : 0;

            return (
              <button
                key={sourceKey}
                ref={isCurrentSource ? currentItemRef : null}
                type='button'
                aria-current={isCurrentSource ? 'true' : undefined}
                onClick={() => {
                  if (!isCurrentSource) {
                    handleSourceClick(source);
                  }
                }}
                className={`relative flex w-full shrink-0 flex-col gap-2 rounded-lg px-2 py-2.5 text-left transition-colors ${
                  isCurrentSource
                    ? 'bg-brand-500/[0.08] dark:bg-brand-400/[0.1]'
                    : 'hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className='flex min-w-0 items-center gap-1.5'>
                  <span
                    className={`min-w-0 truncate text-sm font-medium ${
                      isCurrentSource
                        ? 'text-brand-600 dark:text-brand-300'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {source.source_name}
                  </span>
                  {isCurrentSource && (
                    <span className='shrink-0 rounded bg-brand-500/15 px-1 text-[10px] font-medium leading-4 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300'>
                      播放中
                    </span>
                  )}
                  {(details || resolution) && (
                    <span className='min-w-0 shrink-[4] truncate text-xs text-gray-500 dark:text-gray-400'>
                      {details}
                      {details && resolution && ' · '}
                      {resolution && <span title='分辨率'>{resolution}</span>}
                    </span>
                  )}
                  <span className='ml-auto shrink-0 pl-2 text-xs tabular-nums'>
                    {isTesting ? (
                      <span className='flex items-center gap-1.5 text-gray-400 dark:text-gray-500'>
                        <Spinner className='h-3 w-3' />
                        检测中
                      </span>
                    ) : hasError ? (
                      <span className='text-red-600 dark:text-red-400'>
                        检测失败
                      </span>
                    ) : isDeferred ? (
                      <span
                        className='text-amber-600 dark:text-amber-400'
                        title='服务器检测额度已满，不代表播放源失效'
                      >
                        检测暂缓
                      </span>
                    ) : (
                      speed && (
                        <span className='font-medium text-gray-800 dark:text-gray-200'>
                          {speed}
                        </span>
                      )
                    )}
                  </span>
                </div>

                <div className='flex w-full items-center gap-3'>
                  <span
                    aria-hidden='true'
                    className='h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-900/[0.06] dark:bg-white/[0.08]'
                  >
                    {speedRatio > 0 && (
                      <span
                        className={`block h-full rounded-full ${
                          isCurrentSource
                            ? 'bg-brand-500 dark:bg-brand-400'
                            : 'bg-gray-400 dark:bg-gray-500'
                        }`}
                        style={{ width: `${speedRatio * 100}%` }}
                      />
                    )}
                  </span>
                  <span className='flex w-12 shrink-0 items-center justify-end gap-1 text-[11px] tabular-nums text-gray-400 dark:text-gray-500'>
                    {hasError || isDeferred ? (
                      <span
                        role='button'
                        tabIndex={0}
                        className='hover:text-gray-900 dark:hover:text-white'
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
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.click();
                          }
                        }}
                      >
                        重试
                      </span>
                    ) : (
                      pingTime !== null && (
                        <>
                          <span
                            aria-hidden='true'
                            className={`h-1.5 w-1.5 rounded-full ${pingDotClass(pingTime)}`}
                          />
                          {(pingTime / 1000).toFixed(2)}s
                        </>
                      )
                    )}
                  </span>
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
            className={`${FLOATING_CONTROL_CLASS} absolute bottom-4 right-5 z-10 h-8 w-8`}
            aria-label='回到当前源'
            title='回到当前源'
          >
            <LocateFixed className='h-4 w-4' />
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
