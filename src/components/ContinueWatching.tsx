'use client';

import { ChevronRight, History } from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';
import { HOME_POSTER_CARD_CLASS } from '@/components/HomePosterCardSkeleton';
import { useOptionalMessageCenter } from '@/components/messages/MessageCenterProvider';
import MobileContinueCard from '@/components/MobileContinueCard';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';
import { useIsMobileViewport } from '@/hooks/useIsMobileViewport';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import type { PlayRecord } from '@/lib/db.client';
import {
  getCachedPlayRecordsSnapshot,
  getPlayRecordPage,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  readContinueWatchingCount,
  writeContinueWatchingCount,
} from '@/lib/local-preferences';
import {
  getPlayRecordEpisodeDisplay,
  getPlayRecordResumeGroup,
  hasPlayRecordUpdate,
} from '@/lib/play-records';
import { parseStorageKey } from '@/lib/utils';

interface ContinueWatchingProps {
  className?: string;
  initialSkeletonCount?: number;
  initialRecords?: Record<string, PlayRecord> | null;
  initialUpdateCount?: number;
  refreshOnMount?: boolean;
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type PlayRecordWithKey = PlayRecord & { key: string };

const DEFAULT_CONTINUE_WATCHING_LIMIT = 10;

function sortPlayRecords(
  allRecords: Record<string, PlayRecord>,
): PlayRecordWithKey[] {
  return Object.entries(allRecords)
    .map(([key, record]) => ({
      ...record,
      key,
    }))
    .sort((a, b) => b.save_time - a.save_time);
}

function readInitialState(limit: number, fallbackSkeletonCount = 0) {
  if (typeof window === 'undefined') {
    return {
      playRecords: [] as PlayRecordWithKey[],
      loading: false,
      skeletonCount: 0,
    };
  }

  const isAuthenticated = !!getAuthInfoFromBrowserCookie()?.username;
  if (!isAuthenticated) {
    return {
      playRecords: [] as PlayRecordWithKey[],
      loading: false,
      skeletonCount: 0,
    };
  }

  const cachedRecords = getCachedPlayRecordsSnapshot();
  if (cachedRecords) {
    return {
      playRecords: sortPlayRecords(cachedRecords).slice(0, limit),
      loading: false,
      skeletonCount: 0,
    };
  }

  const cachedCount = Math.max(
    fallbackSkeletonCount,
    readContinueWatchingCount(),
  );
  return {
    playRecords: [] as PlayRecordWithKey[],
    loading: cachedCount > 0,
    skeletonCount: cachedCount > 0 ? Math.min(cachedCount, limit) : 0,
  };
}

export default function ContinueWatching({
  className,
  initialSkeletonCount = 0,
  initialRecords = null,
  initialUpdateCount,
  refreshOnMount = true,
}: ContinueWatchingProps) {
  const runtimeConfig = useRuntimeConfig();
  const continueWatchingLimit = Math.max(
    1,
    Math.floor(
      runtimeConfig.CONTINUE_WATCHING_LIMIT || DEFAULT_CONTINUE_WATCHING_LIMIT,
    ),
  );
  const normalizedInitialSkeletonCount = Math.min(
    initialSkeletonCount,
    continueWatchingLimit,
  );
  const seededRecords = useMemo(
    () =>
      initialRecords
        ? sortPlayRecords(initialRecords).slice(0, continueWatchingLimit)
        : null,
    [initialRecords, continueWatchingLimit],
  );
  const [playRecords, setPlayRecords] = useState<PlayRecordWithKey[]>(
    seededRecords ?? [],
  );
  const [loading, setLoading] = useState(
    !seededRecords && normalizedInitialSkeletonCount > 0,
  );
  const [skeletonCount, setSkeletonCount] = useState(
    seededRecords ? 0 : normalizedInitialSkeletonCount,
  );
  const messageCenter = useOptionalMessageCenter();
  const seededUpdateCount =
    initialUpdateCount === undefined
      ? 0
      : Math.max(0, Math.floor(initialUpdateCount));
  const updateCount = messageCenter?.trackingUnreadCount ?? seededUpdateCount;
  const isMobile = useIsMobileViewport();
  const mobileRecords = playRecords.slice(0, continueWatchingLimit);

  const updatePlayRecords = useCallback(
    (allRecords: Record<string, PlayRecord>) => {
      const sortedRecords = sortPlayRecords(allRecords).slice(
        0,
        continueWatchingLimit,
      );

      setPlayRecords(sortedRecords);
    },
    [continueWatchingLimit],
  );

  useEffect(() => {
    if (loading) return;

    writeContinueWatchingCount(playRecords.length);
  }, [loading, playRecords.length]);

  useIsomorphicLayoutEffect(() => {
    if (seededRecords) {
      setPlayRecords(seededRecords);
      setLoading(false);
      setSkeletonCount(0);
      return;
    }

    const nextState = readInitialState(
      continueWatchingLimit,
      normalizedInitialSkeletonCount,
    );
    setPlayRecords(nextState.playRecords);
    setLoading(nextState.loading);
    setSkeletonCount(nextState.skeletonCount);
  }, [continueWatchingLimit, normalizedInitialSkeletonCount, seededRecords]);

  useEffect(() => {
    if (!refreshOnMount) return;

    const isAuthenticated = !!getAuthInfoFromBrowserCookie()?.username;
    if (!isAuthenticated) return;

    const fetchPlayRecords = async () => {
      try {
        const page = await getPlayRecordPage(continueWatchingLimit);
        updatePlayRecords(page.items);
      } catch (error) {
        console.error('获取播放记录失败:', error);
        if (!seededRecords) {
          setPlayRecords([]);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPlayRecords();

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      },
    );
    const unsubscribeRecent = subscribeToDataUpdates(
      'recentPlayRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      },
    );
    const unsubscribeStates = subscribeToDataUpdates(
      'playRecordStatesUpdated',
      (updates: Record<string, PlayRecord>) => {
        setPlayRecords((current) =>
          current.map((record) =>
            updates[record.key]
              ? { ...updates[record.key], key: record.key }
              : record,
          ),
        );
      },
    );

    return () => {
      unsubscribe();
      unsubscribeRecent();
      unsubscribeStates();
    };
  }, [continueWatchingLimit, refreshOnMount, seededRecords, updatePlayRecords]);

  if (!loading && playRecords.length === 0) {
    return null;
  }

  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  const parseKey = (key: string) => {
    return parseStorageKey(key);
  };

  return (
    <section className={`mb-2 ${className || ''}`}>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-gray-200 sm:text-xl'>
          <History className='h-5 w-5 text-orange-500' />
          继续观看
        </h2>
        {!loading && playRecords.length > 0 && (
          <Link
            href='/continue-watching'
            className={
              updateCount > 0
                ? 'flex items-center text-sm font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300'
                : 'flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }
          >
            {updateCount > 0 ? `${updateCount} 部有更新` : '查看更多'}
            <ChevronRight className='ml-1 h-4 w-4' />
          </Link>
        )}
      </div>
      <ScrollableRow>
        {loading
          ? Array.from({ length: skeletonCount }).map((_, index) => (
              <ContinueWatchingCardSkeleton key={index} />
            ))
          : isMobile
            ? mobileRecords.map((record) => {
                const parsedKey = parseKey(record.key);
                if (!parsedKey) {
                  return null;
                }

                const { source, id } = parsedKey;
                const episodeDisplay = getPlayRecordEpisodeDisplay(record);
                return (
                  <MobileContinueCard
                    key={record.key}
                    source={source}
                    id={id}
                    title={record.title}
                    poster={record.cover}
                    year={record.year}
                    sourceName={record.source_name}
                    currentEpisode={episodeDisplay.currentEpisode}
                    totalEpisodes={episodeDisplay.totalEpisodes}
                    resumeEpisodeIndex={Math.max(0, record.index - 1)}
                    resumeGroup={getPlayRecordResumeGroup(record)}
                    progress={getProgress(record)}
                    hasUpdate={hasPlayRecordUpdate(record)}
                    trackingEnabled={record.tracking_enabled !== false}
                    availableEpisodes={episodeDisplay.totalEpisodes}
                    resumeTime={Math.max(0, Math.floor(record.play_time || 0))}
                    query={record.search_title}
                    onDelete={() =>
                      setPlayRecords((prev) =>
                        prev.filter((r) => r.key !== record.key),
                      )
                    }
                  />
                );
              })
            : playRecords.map((record, index) => {
                const parsedKey = parseKey(record.key);
                if (!parsedKey) {
                  return null;
                }

                const { source, id } = parsedKey;
                const episodeDisplay = getPlayRecordEpisodeDisplay(record);
                return (
                  <div key={record.key} className={HOME_POSTER_CARD_CLASS}>
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      hasUpdate={hasPlayRecordUpdate(record)}
                      trackingEnabled={record.tracking_enabled !== false}
                      availableEpisodes={episodeDisplay.totalEpisodes}
                      episodes={episodeDisplay.totalEpisodes}
                      currentEpisode={episodeDisplay.currentEpisode}
                      resumeEpisodeIndex={Math.max(0, record.index - 1)}
                      resumeGroup={getPlayRecordResumeGroup(record)}
                      resumeTime={Math.max(
                        0,
                        Math.floor(record.play_time || 0),
                      )}
                      query={record.search_title}
                      from='playrecord'
                      onDelete={() =>
                        setPlayRecords((prev) =>
                          prev.filter((r) => r.key !== record.key),
                        )
                      }
                      priority={index < 4}
                      type={record.total_episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                );
              })}
      </ScrollableRow>
    </section>
  );
}
