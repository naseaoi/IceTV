'use client';

import type Artplayer from 'artplayer';
import { MutableRefObject, useCallback, useEffect, useRef } from 'react';

import {
  type PlaybackSessionReport,
  type PlaybackSessionReportResponse,
  PLAYBACK_BUCKET_MS,
} from '@/features/playback-stats/types';
import { resolveEpisodeGroupPosition } from '@/lib/episode-groups';
import { showToast } from '@/lib/toast';
import type { SearchResult, WatchHistoryWrite } from '@/lib/types';
import {
  type WatchLevel,
  isWatchLevel,
  WATCH_LEVEL_UP_EVENT,
  watchLevelName,
} from '@/lib/watch-level';

export type PlaybackStatsEvent =
  | 'playing'
  | 'timeupdate'
  | 'pause'
  | 'waiting'
  | 'stalled'
  | 'seeking'
  | 'seeked'
  | 'ended'
  | 'error'
  | 'stop';

function announceWatchLevelUp(level: WatchLevel) {
  showToast(`观影等级升到 ${level} 级 · ${watchLevelName(level)}`, 'success', {
    key: 'watch-level-up',
  });
  window.dispatchEvent(new Event(WATCH_LEVEL_UP_EVENT));
}

type Sample = { monotonic: number; wall: number; position: number };
type SessionState = {
  session: PlaybackSessionReport['session'];
  history: WatchHistoryWrite;
  buckets: Map<number, { total: number; acknowledged: number }>;
  sample: Sample | null;
  playing: boolean;
  inFlight: boolean;
  queued: boolean;
};

type UsePlaybackStatsReporterParams = {
  artPlayerRef: MutableRefObject<Artplayer | null>;
  currentSourceRef: MutableRefObject<string>;
  currentIdRef: MutableRefObject<string>;
  videoTitleRef: MutableRefObject<string>;
  detailRef: MutableRefObject<SearchResult | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  stableCurrentTimeRef: MutableRefObject<number>;
};

const REPORT_INTERVAL_MS = 30_000;
const MAX_TICK_MS = 5_000;

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  );
}

function workKey(session: PlaybackSessionReport['session']): string {
  return JSON.stringify([session.source, session.video_id]);
}

export function usePlaybackStatsReporter({
  artPlayerRef,
  currentSourceRef,
  currentIdRef,
  videoTitleRef,
  detailRef,
  currentEpisodeIndexRef,
  stableCurrentTimeRef,
}: UsePlaybackStatsReporterParams) {
  const activeRef = useRef<SessionState | null>(null);
  const sessionsRef = useRef(new Map<string, SessionState>());
  const lastReportAtRef = useRef(0);
  // null 是本页删除墓碑，迟到的成功响应不能覆盖它。
  const historyIdsRef = useRef(new Map<string, string | null>());

  const getActiveSession = useCallback(() => {
    const state = activeRef.current;
    return state &&
      state.session.source === currentSourceRef.current &&
      state.session.video_id === currentIdRef.current &&
      state.session.episode_index === currentEpisodeIndexRef.current + 1
      ? state
      : null;
  }, [currentSourceRef, currentIdRef, currentEpisodeIndexRef]);

  const readSample = useCallback((): Sample => {
    const position =
      artPlayerRef.current?.currentTime ?? stableCurrentTimeRef.current;
    return {
      monotonic: Math.floor(performance.now()),
      wall: Date.now(),
      position: Number.isFinite(position) ? Math.max(0, position) : 0,
    };
  }, [artPlayerRef, stableCurrentTimeRef]);

  const refreshMetadata = useCallback(
    (state: SessionState) => {
      const detail = detailRef.current;
      const group = resolveEpisodeGroupPosition(
        detail?.episode_groups,
        currentEpisodeIndexRef.current,
        detail?.episodes.length || 0,
      );
      const label = group
        ? detail?.episode_groups?.[group.groupIndex]?.label
        : undefined;
      state.history = {
        total_episodes: detail?.episodes.length || 1,
        ...(group
          ? {
              group_index: group.episodeOffset + 1,
              group_total: group.groupCount,
              ...(label ? { group_label: label } : {}),
            }
          : {}),
      };
      const duration = artPlayerRef.current?.duration || 0;
      Object.assign(state.session, {
        title: videoTitleRef.current,
        source_name: detail?.source_name || '',
        cover: detail?.poster || '',
        year: detail?.year || '',
        last_position: Math.floor(readSample().position),
        total_time:
          Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0,
        ended_at: Date.now(),
      });
    },
    [
      detailRef,
      currentEpisodeIndexRef,
      artPlayerRef,
      videoTitleRef,
      readSample,
    ],
  );

  const flushSession = useCallback(async function flush(state: SessionState) {
    if (state.inFlight) {
      state.queued = true;
      return;
    }
    const buckets = Array.from(state.buckets, ([start, value]) => ({
      start,
      watch_ms: value.total,
      acknowledged: value.acknowledged,
    }))
      .filter((bucket) => bucket.watch_ms > bucket.acknowledged)
      .map(({ start, watch_ms }) => ({ start, watch_ms }));
    if (!buckets.length) {
      if (activeRef.current !== state)
        sessionsRef.current.delete(state.session.id);
      return;
    }

    state.inFlight = true;
    state.queued = false;
    let succeeded = false;
    try {
      // 长时间离线后的积压按接口上限拆批，每批仍发送累计值。
      for (let offset = 0; offset < buckets.length; offset += 100) {
        const key = workKey(state.session);
        const historyId = historyIdsRef.current.get(key);
        const report: PlaybackSessionReport = {
          session: { ...state.session },
          buckets: buckets.slice(offset, offset + 100),
          ...(historyId === null
            ? {}
            : {
                history: {
                  ...state.history,
                  ...(historyId ? { id: historyId } : {}),
                },
              }),
        };
        const response = await fetch('/api/playback-stats/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
          keepalive: true,
        });
        if (!response.ok) {
          throw new Error(`Playback stats request failed: ${response.status}`);
        }
        const result: PlaybackSessionReportResponse = await response.json();
        if (isWatchLevel(result.levelUp?.level)) {
          announceWatchLevelUp(result.levelUp.level);
        }
        if (report.history?.id && result.historyId === null) {
          historyIdsRef.current.set(key, null);
        } else if (
          report.history &&
          typeof result.historyId === 'string' &&
          historyIdsRef.current.get(key) !== null
        ) {
          historyIdsRef.current.set(key, result.historyId);
        }
        for (const bucket of report.buckets) {
          const value = state.buckets.get(bucket.start);
          if (value) value.acknowledged = bucket.watch_ms;
        }
      }
      succeeded = true;
    } catch (error) {
      console.warn('播放统计上报失败:', error);
    } finally {
      state.inFlight = false;
      // 失败等待下一次定时或强制上报，避免离线时立即重试形成循环。
      if (succeeded && state.queued) {
        void flush(state);
      } else if (
        succeeded &&
        activeRef.current !== state &&
        Array.from(state.buckets.values()).every(
          (bucket) => bucket.total === bucket.acknowledged,
        )
      ) {
        sessionsRef.current.delete(state.session.id);
      }
    }
  }, []);

  const reportPlaybackStats = useCallback(
    (force = false) => {
      const active = getActiveSession();
      if (active) refreshMetadata(active);
      const now = performance.now();
      if (force || now - lastReportAtRef.current >= REPORT_INTERVAL_MS) {
        lastReportAtRef.current = now;
        for (const state of sessionsRef.current.values())
          void flushSession(state);
      }
    },
    [getActiveSession, refreshMetadata, flushSession],
  );

  const startPlaybackStatsSession = useCallback(() => {
    const existing = getActiveSession();
    if (existing) return;
    const previous = activeRef.current;
    if (previous) {
      previous.playing = false;
      previous.sample = null;
      void flushSession(previous);
      if (!previous.buckets.size)
        sessionsRef.current.delete(previous.session.id);
    }
    activeRef.current = null;
    if (
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current
    )
      return;
    const now = Date.now();
    const state: SessionState = {
      session: {
        id: createSessionId(),
        source: currentSourceRef.current,
        video_id: currentIdRef.current,
        episode_index: currentEpisodeIndexRef.current + 1,
        title: videoTitleRef.current,
        source_name: '',
        cover: '',
        year: '',
        started_at: now,
        ended_at: now,
        created_at: now,
        last_position: 0,
        total_time: 0,
      },
      history: { total_episodes: 1 },
      buckets: new Map(),
      sample: null,
      playing: false,
      inFlight: false,
      queued: false,
    };
    refreshMetadata(state);
    activeRef.current = state;
    sessionsRef.current.set(state.session.id, state);
  }, [
    getActiveSession,
    flushSession,
    currentSourceRef,
    currentIdRef,
    videoTitleRef,
    currentEpisodeIndexRef,
    refreshMetadata,
  ]);

  const handlePlaybackStatsEvent = useCallback(
    (event: PlaybackStatsEvent) => {
      if (event === 'stop') {
        if (activeRef.current) {
          activeRef.current.playing = false;
          activeRef.current.sample = null;
        }
        reportPlaybackStats(true);
        return;
      }
      if (event === 'playing') startPlaybackStatsSession();
      const state = getActiveSession();
      if (!state) return;
      const video = artPlayerRef.current?.video;
      if (event === 'playing' || event === 'seeked') {
        state.playing =
          !!video &&
          !video.paused &&
          !video.seeking &&
          !video.ended &&
          !video.error &&
          video.readyState >= 3;
        state.sample = state.playing ? readSample() : null;
        return;
      }
      if (event !== 'timeupdate') {
        state.playing = false;
        state.sample = null;
        if (event === 'pause' || event === 'ended' || event === 'error') {
          reportPlaybackStats(true);
        }
        return;
      }
      if (
        !video ||
        video.paused ||
        video.seeking ||
        video.ended ||
        video.error ||
        video.readyState < 3
      ) {
        state.playing = false;
        state.sample = null;
        return;
      }
      // playing 事件触发时数据可能尚未就绪，由后续 timeupdate 补上计时起点
      if (!state.playing) {
        state.playing = true;
        state.sample = readSample();
        return;
      }
      const next = readSample();
      const previous = state.sample;
      state.sample = next;
      refreshMetadata(state);
      if (!previous || next.position <= previous.position) return;
      const elapsed = next.monotonic - previous.monotonic;
      const wallElapsed = next.wall - previous.wall;
      // 休眠、后台节流与系统时钟跳变的间隔直接丢弃，不把拖欠时间补进统计。
      if (
        elapsed <= 0 ||
        elapsed > MAX_TICK_MS ||
        wallElapsed <= 0 ||
        wallElapsed > MAX_TICK_MS
      )
        return;
      let remaining = elapsed;
      let cursor = previous.wall;
      while (cursor < next.wall) {
        const start =
          Math.floor(cursor / PLAYBACK_BUCKET_MS) * PLAYBACK_BUCKET_MS;
        const end = Math.min(start + PLAYBACK_BUCKET_MS, next.wall);
        const milliseconds =
          end === next.wall
            ? remaining
            : Math.floor((elapsed * (end - cursor)) / wallElapsed);
        remaining -= milliseconds;
        if (milliseconds > 0) {
          const bucket = state.buckets.get(start) || {
            total: 0,
            acknowledged: 0,
          };
          bucket.total = Math.min(
            PLAYBACK_BUCKET_MS,
            bucket.total + milliseconds,
          );
          state.buckets.set(start, bucket);
        }
        cursor = end;
      }
    },
    [
      startPlaybackStatsSession,
      getActiveSession,
      artPlayerRef,
      readSample,
      refreshMetadata,
      reportPlaybackStats,
    ],
  );

  useEffect(() => {
    const flush = () => reportPlaybackStats(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
      // 恢复可见性后从新采样点计时，避免跨页面冻结周期补算。
      if (activeRef.current) activeRef.current.sample = null;
    };
    const timer = window.setInterval(flush, REPORT_INTERVAL_MS);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flush();
      if (activeRef.current) {
        activeRef.current.playing = false;
        activeRef.current.sample = null;
      }
    };
  }, [reportPlaybackStats]);

  return {
    startPlaybackStatsSession,
    reportPlaybackStats,
    handlePlaybackStatsEvent,
  };
}
