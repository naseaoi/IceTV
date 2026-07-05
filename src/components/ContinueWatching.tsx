'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

import { History } from 'lucide-react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  getAllPlayRecords,
  getCachedPlayRecordsSnapshot,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { parseStorageKey } from '@/lib/utils';

import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';
import HomePosterCardSkeleton, {
  HOME_POSTER_CARD_CLASS,
} from '@/components/HomePosterCardSkeleton';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';

interface ContinueWatchingProps {
  className?: string;
  initialSkeletonCount?: number;
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
    parseInt(localStorage.getItem('continueWatchingCount') || '0', 10),
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
  const [playRecords, setPlayRecords] = useState<PlayRecordWithKey[]>([]);
  const [loading, setLoading] = useState(normalizedInitialSkeletonCount > 0);
  const [skeletonCount, setSkeletonCount] = useState(
    normalizedInitialSkeletonCount,
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const updatePlayRecords = (allRecords: Record<string, PlayRecord>) => {
    const sortedRecords = sortPlayRecords(allRecords).slice(
      0,
      continueWatchingLimit,
    );

    setPlayRecords(sortedRecords);
    const count = String(sortedRecords.length);
    try {
      localStorage.setItem('continueWatchingCount', count);
    } catch {
      void 0;
    }
    document.cookie = `cw_count=${count};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
  };

  useIsomorphicLayoutEffect(() => {
    const nextState = readInitialState(
      continueWatchingLimit,
      normalizedInitialSkeletonCount,
    );
    setPlayRecords(nextState.playRecords);
    setLoading(nextState.loading);
    setSkeletonCount(nextState.skeletonCount);
  }, [continueWatchingLimit, normalizedInitialSkeletonCount]);

  useEffect(() => {
    const isAuthenticated = !!getAuthInfoFromBrowserCookie()?.username;
    if (!isAuthenticated) return;

    const fetchPlayRecords = async () => {
      try {
        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
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

    return unsubscribe;
  }, []);

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
    <>
      <section className={`mb-4 ${className || ''}`}>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
            <History className='h-5 w-5 text-orange-500' />
            继续观看
          </h2>
          {!loading && playRecords.length > 0 && (
            <button
              className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              onClick={() => setShowClearConfirm(true)}
            >
              清空
            </button>
          )}
        </div>
        <ScrollableRow>
          {loading
            ? Array.from({ length: skeletonCount }).map((_, index) => (
                <HomePosterCardSkeleton key={index} withSubtitle />
              ))
            : playRecords.map((record, index) => {
                const parsedKey = parseKey(record.key);
                if (!parsedKey) {
                  return null;
                }

                const { source, id } = parsedKey;
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
                      episodes={record.total_episodes}
                      currentEpisode={record.index}
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

      <ConfirmModal
        isOpen={showClearConfirm}
        title='确认清空继续观看记录？'
        message='该操作会删除所有继续观看记录，删除后无法恢复。'
        danger
        cancelText='再想想'
        confirmText='确认清空'
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={async () => {
          await clearAllPlayRecords();
          setPlayRecords([]);
          setShowClearConfirm(false);
          try {
            localStorage.setItem('continueWatchingCount', '0');
          } catch {}
          document.cookie = 'cw_count=0;path=/;max-age=0;samesite=lax';
        }}
      />
    </>
  );
}
