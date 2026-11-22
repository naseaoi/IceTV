import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildEpisodeProgressKeys,
  getPlaybackRecordsRetryDelay,
} from '@/features/play/lib/episodeProgress';
import {
  AUTH_SESSION_LOST_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth.client';
import {
  generateStorageKey,
  readPlayRecordsForPlayback,
} from '@/lib/db.client';
import {
  type EpisodeProgressEntry,
  mergeEpisodeProgress,
} from '@/lib/episode-progress';
import { normalizeWorkTitle } from '@/lib/source-match';
import type { PlayRecord, SearchResult } from '@/lib/types';

interface UseEpisodeProgressOptions {
  currentSource: string;
  currentId: string;
  videoTitle: string;
  detail: SearchResult | null;
}

export interface EpisodeProgressController {
  /** 当前详情下每一集的进度条目，下标即集索引 */
  episodeEntries: (EpisodeProgressEntry | undefined)[];
  getEpisodeKey: (episodeIndex: number) => string | undefined;
  getEpisodeEntry: (episodeIndex: number) => EpisodeProgressEntry | undefined;
  mergeEpisodeProgress: (list: unknown) => void;
  acceptPlayRecord: (key: string, record: PlayRecord | undefined) => void;
  ensureLoaded: () => void;
}

/**
 * 播放页内的每集进度表。集身份与源无关，换源时整表沿用，按当前详情重新对应到集；
 * 换到另一部作品才清空。服务端是真相源，本地表只并入读到的记录与本页刚保存的快照。
 */
export function useEpisodeProgress({
  currentSource,
  currentId,
  videoTitle,
  detail,
}: UseEpisodeProgressOptions): EpisodeProgressController {
  const entriesRef = useRef<EpisodeProgressEntry[]>([]);
  const [entries, setEntries] = useState<EpisodeProgressEntry[]>([]);

  const merge = useCallback((list: unknown) => {
    const next = mergeEpisodeProgress([entriesRef.current, list]);
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const workRef = useRef('');
  const work = videoTitle ? normalizeWorkTitle(videoTitle) : workRef.current;
  const generationRef = useRef(0);
  const loadedKeysRef = useRef(new Set<string>());
  const retryTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (workRef.current && workRef.current !== work) {
      entriesRef.current = [];
      setEntries([]);
    }
    workRef.current = work;
    const cancelLoads = () => {
      generationRef.current += 1;
      retryTimersRef.current.forEach(clearTimeout);
      retryTimersRef.current.clear();
      loadedKeysRef.current.clear();
    };
    window.addEventListener(AUTH_SESSION_LOST_EVENT, cancelLoads);
    return () => {
      cancelLoads();
      window.removeEventListener(AUTH_SESSION_LOST_EVENT, cancelLoads);
    };
  }, [work]);

  // 已接收或正在补读的键；同一作品换源保留，换作品或卸载后释放。

  const acceptPlayRecord = useCallback(
    (key: string, record: PlayRecord | undefined) => {
      loadedKeysRef.current.add(key);
      merge(record?.episode_progress);
    },
    [merge],
  );

  const currentKey =
    currentSource && currentId
      ? generateStorageKey(currentSource, currentId)
      : '';
  const currentKeyRef = useRef(currentKey);
  useEffect(() => {
    currentKeyRef.current = currentKey;
  }, [currentKey]);

  // 带播放意图起播时不读播放记录；起播后补读，失败重试不占起播路径。
  const ensureLoaded = useCallback(() => {
    const key = currentKeyRef.current;
    if (!key || loadedKeysRef.current.has(key)) return;
    const generation = generationRef.current;
    const username = getAuthInfoFromBrowserCookie()?.username;
    if (!username) return;
    loadedKeysRef.current.add(key);
    const isCurrent = () =>
      generationRef.current === generation &&
      getAuthInfoFromBrowserCookie()?.username === username;
    const load = (attempt: number) => {
      if (!isCurrent()) return;
      const read = readPlayRecordsForPlayback([key]);
      if (read.cached) merge(read.cached[key]?.episode_progress);
      read.fresh
        .then((records) => {
          // 集进度按作品沿用；同作品换源仍接收旧源迟到的整表。
          if (isCurrent()) merge(records[key]?.episode_progress);
        })
        .catch(() => {
          if (!isCurrent()) return;
          const timer = setTimeout(() => {
            retryTimersRef.current.delete(timer);
            load(attempt + 1);
          }, getPlaybackRecordsRetryDelay(attempt));
          retryTimersRef.current.add(timer);
        });
    };
    load(0);
  }, [merge]);

  const keys = useMemo(() => buildEpisodeProgressKeys(detail), [detail]);

  const getEpisodeKey = useCallback(
    (episodeIndex: number) => keys[episodeIndex] || undefined,
    [keys],
  );
  const getEpisodeEntry = useCallback(
    (episodeIndex: number) => {
      const key = keys[episodeIndex];
      return key
        ? entriesRef.current.find((entry) => entry.k === key)
        : undefined;
    },
    [keys],
  );

  const episodeEntries = useMemo(() => {
    const byKey = new Map(entries.map((entry) => [entry.k, entry]));
    return keys.map((key) => (key ? byKey.get(key) : undefined));
  }, [entries, keys]);

  return {
    episodeEntries,
    getEpisodeKey,
    getEpisodeEntry,
    mergeEpisodeProgress: merge,
    acceptPlayRecord,
    ensureLoaded,
  };
}
