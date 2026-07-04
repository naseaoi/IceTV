'use client';

import type Artplayer from 'artplayer';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from 'react';

import {
  deletePlayRecord,
  deleteSkipConfig,
  saveSkipConfig,
} from '@/lib/db.client';
import {
  clearSourceFailure,
  markSourceFailed,
} from '@/lib/failed-source-cooldown';
import {
  getManagedVideo,
  markManagedVideoExpectedAbort,
} from '@/lib/player-runtime';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { SearchResult, SkipConfig } from '@/lib/types';

import { resolveEpisodeTargetIndex } from '@/features/play/lib/episodeMapping';
import {
  resolveSourceSwitchCurrentPlayTime,
  resolveSourceSwitchEpisodeAnchor,
  resolveSourceSwitchResumeState,
  type SourceSwitchEpisodeAnchor,
} from '@/features/play/lib/episodeResumePolicy';
import { saveDetailSnapshot } from '@/features/play/lib/detailSnapshot';
import { savePlayIntent } from '@/lib/play-intent';
import {
  finalizeSourceSwitchCleanup,
  shouldFinalizeSourceSwitchCleanup,
  type SourceSwitchCleanupTask,
} from '@/features/play/lib/sourceSwitchCleanup';
import type {
  PlaybackRequestMode,
  SkipConfigState,
  VideoLoadingStage,
  VideoQualityInfo,
} from '@/features/play/hooks/usePlayPageState';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';

const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function parseLoadSpeedKBps(speed?: string): number {
  if (!speed) return 0;
  const match = speed.match(/^([\d.]+)\s*(Mbps|Mb\/s|KB\/s|MB\/s)$/);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = match[2];
  if (unit === 'Mbps' || unit === 'Mb/s') return (value * 1024) / 8;
  if (unit === 'MB/s') return value * 1024;
  return value;
}

function hasDisplayText(value?: string): boolean {
  const text = value?.trim();
  return !!text && text !== 'unknown';
}

function mergeSourceSwitchDetail(
  preferred: SearchResult,
  fallback?: SearchResult,
  previous?: SearchResult | null,
): SearchResult {
  return {
    ...fallback,
    ...preferred,
    title: hasDisplayText(preferred.title)
      ? preferred.title
      : hasDisplayText(fallback?.title)
        ? fallback!.title
        : previous?.title || '',
    poster: preferred.poster || fallback?.poster || previous?.poster || '',
    episodes:
      preferred.episodes && preferred.episodes.length > 0
        ? preferred.episodes
        : fallback?.episodes || [],
    episodes_titles:
      preferred.episodes_titles && preferred.episodes_titles.length > 0
        ? preferred.episodes_titles
        : fallback?.episodes_titles || [],
    source_name: preferred.source_name || fallback?.source_name || '',
    year: hasDisplayText(preferred.year)
      ? preferred.year
      : hasDisplayText(fallback?.year)
        ? fallback!.year
        : previous?.year || preferred.year || fallback?.year || '',
    class: preferred.class || fallback?.class || previous?.class,
    desc: preferred.desc || fallback?.desc || previous?.desc,
    type_name:
      preferred.type_name || fallback?.type_name || previous?.type_name,
    douban_id:
      preferred.douban_id || fallback?.douban_id || previous?.douban_id,
    related_sources:
      preferred.related_sources ||
      fallback?.related_sources ||
      previous?.related_sources,
  };
}

interface UseSourceSwitchOptions {
  availableSources: SearchResult[];
  precomputedVideoInfo: Map<string, VideoQualityInfo>;
  autoSwitchSourceOnTimeout: boolean;
  currentEpisodeIndex: number;

  artPlayerRef: RefObject<Artplayer | null>;
  currentSourceRef: RefObject<string>;
  currentIdRef: RefObject<string>;
  detailRef: RefObject<SearchResult | null>;
  currentEpisodeIndexRef: RefObject<number>;
  skipConfigRef: RefObject<SkipConfigState>;
  resumeTimeRef: RefObject<number | null>;
  resumeModeRef: RefObject<ResumeMode>;
  stableCurrentTimeRef: RefObject<number>;
  clearTargetEpisodeProgressRef: RefObject<boolean>;
  sourceSwitchEpisodeAnchorRef: RefObject<SourceSwitchEpisodeAnchor | null>;
  playbackRequestModeRef: RefObject<PlaybackRequestMode>;
  failedSourcesRef: RefObject<Set<string>>;
  autoFallbackInProgressRef: RefObject<boolean>;
  pendingSourceSwitchCleanupRef: RefObject<SourceSwitchCleanupTask | null>;
  sourceChangeRequestIdRef: RefObject<number>;

  setError: Dispatch<SetStateAction<string | null>>;
  setVideoUrl: Dispatch<SetStateAction<string>>;
  setVideoTitle: Dispatch<SetStateAction<string>>;
  setVideoYear: Dispatch<SetStateAction<string>>;
  setVideoCover: Dispatch<SetStateAction<string>>;
  setVideoDoubanId: Dispatch<SetStateAction<number>>;
  setCurrentSource: Dispatch<SetStateAction<string>>;
  setCurrentId: Dispatch<SetStateAction<string>>;
  setDetail: Dispatch<SetStateAction<SearchResult | null>>;
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
  setAvailableSources: Dispatch<SetStateAction<SearchResult[]>>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setVideoLoadingStage: Dispatch<SetStateAction<VideoLoadingStage>>;
  setVideoLoadingAttempt: Dispatch<SetStateAction<number>>;
  setRealtimeLoadSpeed: Dispatch<SetStateAction<string>>;
  setSourceSearchError: Dispatch<SetStateAction<string | null>>;

  cleanupPlayer: () => void;
}

export function useSourceSwitch(options: UseSourceSwitchOptions) {
  const {
    availableSources,
    precomputedVideoInfo,
    autoSwitchSourceOnTimeout,
    currentEpisodeIndex,
    artPlayerRef,
    currentSourceRef,
    currentIdRef,
    detailRef,
    currentEpisodeIndexRef,
    skipConfigRef,
    resumeTimeRef,
    resumeModeRef,
    stableCurrentTimeRef,
    clearTargetEpisodeProgressRef,
    sourceSwitchEpisodeAnchorRef,
    playbackRequestModeRef,
    failedSourcesRef,
    autoFallbackInProgressRef,
    pendingSourceSwitchCleanupRef,
    sourceChangeRequestIdRef,
    setError,
    setVideoUrl,
    setVideoTitle,
    setVideoYear,
    setVideoCover,
    setVideoDoubanId,
    setCurrentSource,
    setCurrentId,
    setDetail,
    setCurrentEpisodeIndex,
    setAvailableSources,
    setIsVideoLoading,
    setVideoLoadingStage,
    setVideoLoadingAttempt,
    setRealtimeLoadSpeed,
    setSourceSearchError,
    cleanupPlayer,
  } = options;

  const handleLoadingTimeoutRef = useRef<(() => void) | null>(null);

  const stopActiveHlsLoading = useCallback(() => {
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    if (!video) return;

    const managedVideo = getManagedVideo(video);
    try {
      markManagedVideoExpectedAbort(video);
      managedVideo.hls?.stopLoad?.();
    } catch (err) {
      console.warn('停止失败源加载失败:', err);
    }
    setRealtimeLoadSpeed('');
  }, [artPlayerRef, setRealtimeLoadSpeed]);

  const handleSourceChange = useCallback(
    async (
      newSource: string,
      newId: string,
      newTitle: string,
      switchOptions?: { isAutoFallback?: boolean },
    ) => {
      if (
        newSource === currentSourceRef.current &&
        newId === currentIdRef.current
      ) {
        return;
      }

      const isAutoFallback = switchOptions?.isAutoFallback === true;

      if (!isAutoFallback) {
        failedSourcesRef.current = new Set();
        clearSourceFailure(`${newSource}-${newId}`);
      }
      autoFallbackInProgressRef.current = isAutoFallback;

      const targetSource = availableSources.find(
        (source) => source.source === newSource && source.id === newId,
      );
      if (!targetSource) {
        setError('未找到匹配结果');
        return;
      }
      playbackRequestModeRef.current = isAutoFallback
        ? 'auto-source'
        : 'manual-source';

      const currentRequestId = ++sourceChangeRequestIdRef.current;
      const previousSource = currentSourceRef.current;
      const previousId = currentIdRef.current;
      const previousDetail = detailRef.current;
      const previousSkipConfig: SkipConfig = { ...skipConfigRef.current };
      const currentPlayTime = resolveSourceSwitchCurrentPlayTime({
        playerCurrentTime: artPlayerRef.current?.currentTime || 0,
        pendingResumeTime: resumeTimeRef.current,
        stableCurrentTime: stableCurrentTimeRef.current,
      });

      pendingSourceSwitchCleanupRef.current = null;

      try {
        setVideoLoadingStage('sourceChanging');
        setIsVideoLoading(true);
        setVideoLoadingAttempt((prev) => prev + 1);
        setRealtimeLoadSpeed(
          isAutoFallback ? '正在尝试其他源...' : '正在切换源站...',
        );
        setError(null);

        if (artPlayerRef.current) {
          try {
            artPlayerRef.current.pause();
          } catch (err) {
            console.warn('换源时暂停当前视频失败:', err);
          }
        }

        let newDetail = mergeSourceSwitchDetail(
          targetSource,
          targetSource,
          previousDetail,
        );

        try {
          const detailRes = await fetch(
            `/api/detail?source=${newSource}&id=${newId}`,
            IS_DEVELOPMENT ? { cache: 'no-store' } : undefined,
          );
          if (currentRequestId !== sourceChangeRequestIdRef.current) {
            return;
          }
          if (detailRes.ok) {
            const fullDetail = (await detailRes.json()) as SearchResult;
            if (fullDetail.episodes && fullDetail.episodes.length > 0) {
              saveDetailSnapshot(newSource, newId, fullDetail);
              newDetail = mergeSourceSwitchDetail(
                fullDetail,
                targetSource,
                previousDetail,
              );
              setAvailableSources((prev) => mergeSourceBundle(prev, newDetail));
            }
          }
        } catch (err) {
          console.error('换源刷新详情失败:', err);
        }

        if (currentRequestId !== sourceChangeRequestIdRef.current) {
          return;
        }

        const latestEpisodeIndex = Math.max(
          currentEpisodeIndex,
          currentEpisodeIndexRef.current,
        );
        const episodeAnchor = resolveSourceSwitchEpisodeAnchor({
          currentAnchor: sourceSwitchEpisodeAnchorRef.current,
          activeDetail: previousDetail,
          activeEpisodeIndex: latestEpisodeIndex,
        });
        const resolvedEpisodeTarget = resolveEpisodeTargetIndex(
          episodeAnchor.detail,
          episodeAnchor.episodeIndex,
          newDetail,
        );
        let targetIndex = resolvedEpisodeTarget.index;
        let preserveProgress = resolvedEpisodeTarget.preserveProgress;
        const clearTargetEpisodeProgress = isAutoFallback
          ? false
          : clearTargetEpisodeProgressRef.current;

        if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
          targetIndex = 0;
          preserveProgress = false;
        }

        if (
          !preserveProgress &&
          !clearTargetEpisodeProgress &&
          episodeAnchor.episodeIndex > 0
        ) {
          const targetKey = `${newSource}-${newId}`;
          failedSourcesRef.current.add(targetKey);

          if (isAutoFallback) {
            markSourceFailed(targetKey, {
              reason: 'missing-episode',
              message: `missing episode ${episodeAnchor.episodeIndex + 1}`,
            });
            setIsVideoLoading(false);
            setRealtimeLoadSpeed('');
            handleLoadingTimeoutRef.current?.();
            return;
          }

          const targetEpisodeNumber = episodeAnchor.episodeIndex + 1;
          const notice = `该源没有第 ${targetEpisodeNumber} 集，已保留当前播放`;
          const player = artPlayerRef.current;
          if (player) {
            try {
              player.notice.show = notice;
            } catch (err) {
              console.warn('显示换源拒绝提示失败:', err);
            }
          } else {
            setSourceSearchError(notice);
          }
          setIsVideoLoading(false);
          setRealtimeLoadSpeed('');
          playbackRequestModeRef.current = 'initial';
          return;
        }

        sourceSwitchEpisodeAnchorRef.current = episodeAnchor;
        setVideoUrl('');
        cleanupPlayer();

        const nextResumeState = resolveSourceSwitchResumeState({
          currentPlayTime,
          preserveProgress,
          clearTargetEpisodeProgress,
        });

        savePlayIntent({
          source: newDetail.source,
          id: newDetail.id,
          episodeIndex: targetIndex,
          resumeTime: nextResumeState.resumeTime,
        });

        resumeTimeRef.current = nextResumeState.resumeTime;
        resumeModeRef.current = nextResumeState.resumeMode;

        setVideoTitle(
          newDetail.title || newTitle || previousDetail?.title || '',
        );
        setVideoYear(
          hasDisplayText(newDetail.year)
            ? newDetail.year
            : previousDetail?.year || '',
        );
        setVideoCover(newDetail.poster);
        setVideoDoubanId(newDetail.douban_id || 0);
        setCurrentSource(newDetail.source);
        setCurrentId(newDetail.id);
        setDetail(newDetail);
        currentEpisodeIndexRef.current = targetIndex;
        setCurrentEpisodeIndex(targetIndex);
        setRealtimeLoadSpeed('正在加载新源...');

        if (
          previousSource &&
          previousId &&
          (previousSource !== newDetail.source || previousId !== newDetail.id)
        ) {
          pendingSourceSwitchCleanupRef.current = {
            previousSource,
            previousId,
            nextSource: newDetail.source,
            nextId: newDetail.id,
            previousSkipConfig,
            keepPreviousPlayRecord: clearTargetEpisodeProgress,
          };
        }
      } catch (err) {
        if (currentRequestId !== sourceChangeRequestIdRef.current) {
          return;
        }
        pendingSourceSwitchCleanupRef.current = null;
        setIsVideoLoading(false);
        setRealtimeLoadSpeed('');
        playbackRequestModeRef.current = 'initial';
        markSourceFailed(`${newSource}-${newId}`, {
          reason: 'source-switch',
          message: err instanceof Error ? err.message : 'source switch failed',
        });
        setError(err instanceof Error ? err.message : '换源失败');
      }
    },
    [
      availableSources,
      currentEpisodeIndex,
      artPlayerRef,
      currentSourceRef,
      currentIdRef,
      detailRef,
      currentEpisodeIndexRef,
      skipConfigRef,
      resumeTimeRef,
      resumeModeRef,
      stableCurrentTimeRef,
      clearTargetEpisodeProgressRef,
      sourceSwitchEpisodeAnchorRef,
      playbackRequestModeRef,
      failedSourcesRef,
      autoFallbackInProgressRef,
      pendingSourceSwitchCleanupRef,
      sourceChangeRequestIdRef,
      setError,
      setVideoUrl,
      setVideoTitle,
      setVideoYear,
      setVideoCover,
      setVideoDoubanId,
      setCurrentSource,
      setCurrentId,
      setDetail,
      setCurrentEpisodeIndex,
      setAvailableSources,
      setIsVideoLoading,
      setVideoLoadingStage,
      setVideoLoadingAttempt,
      setRealtimeLoadSpeed,
      setSourceSearchError,
      cleanupPlayer,
    ],
  );

  const handleLoadingTimeout = useCallback(() => {
    const curSource = currentSourceRef.current;
    const curId = currentIdRef.current;
    const curDetail = detailRef.current;
    const curEpisodeIndex = Math.max(
      currentEpisodeIndex,
      currentEpisodeIndexRef.current,
    );
    if (!curSource || !curId) return;

    const curKey = `${curSource}-${curId}`;
    failedSourcesRef.current.add(curKey);
    markSourceFailed(curKey, {
      reason: 'timeout',
      message: 'video loading timeout',
    });

    if (!autoSwitchSourceOnTimeout) {
      setRealtimeLoadSpeed('当前源加载超时');
      stopActiveHlsLoading();
      return;
    }
    setRealtimeLoadSpeed('正在尝试其他源...');

    const anchor = sourceSwitchEpisodeAnchorRef.current;
    const referenceDetail = anchor?.detail || curDetail;
    const referenceEpisodeIndex = anchor
      ? anchor.episodeIndex
      : curEpisodeIndex;

    const candidates = availableSources.filter((s) => {
      const key = `${s.source}-${s.id}`;
      if (key === curKey) return false;
      if (failedSourcesRef.current.has(key)) return false;
      if (referenceDetail && referenceEpisodeIndex > 0) {
        const resolved = resolveEpisodeTargetIndex(
          referenceDetail,
          referenceEpisodeIndex,
          s,
        );
        if (!resolved.preserveProgress) {
          return false;
        }
      }
      return true;
    });
    if (candidates.length === 0) {
      stopActiveHlsLoading();
      return;
    }

    const ranked = [...candidates].sort((a, b) => {
      const aInfo = precomputedVideoInfo.get(`${a.source}-${a.id}`);
      const bInfo = precomputedVideoInfo.get(`${b.source}-${b.id}`);
      const aSpeed = parseLoadSpeedKBps(aInfo?.loadSpeed);
      const bSpeed = parseLoadSpeedKBps(bInfo?.loadSpeed);
      return bSpeed - aSpeed;
    });
    const next = ranked[0];
    if (!next) {
      stopActiveHlsLoading();
      return;
    }

    autoFallbackInProgressRef.current = true;
    stopActiveHlsLoading();
    void handleSourceChange(next.source, next.id, next.title, {
      isAutoFallback: true,
    });
  }, [
    autoSwitchSourceOnTimeout,
    availableSources,
    precomputedVideoInfo,
    currentEpisodeIndex,
    stopActiveHlsLoading,
    currentSourceRef,
    currentIdRef,
    detailRef,
    currentEpisodeIndexRef,
    failedSourcesRef,
    sourceSwitchEpisodeAnchorRef,
    autoFallbackInProgressRef,
    setRealtimeLoadSpeed,
    handleSourceChange,
  ]);

  useEffect(() => {
    handleLoadingTimeoutRef.current = handleLoadingTimeout;
  }, [handleLoadingTimeout]);

  const finalizePendingSourceSwitchCleanup = useCallback(
    async (activeSource: string, activeId: string) => {
      const task = pendingSourceSwitchCleanupRef.current;
      if (!shouldFinalizeSourceSwitchCleanup(task, activeSource, activeId)) {
        return;
      }

      pendingSourceSwitchCleanupRef.current = null;

      await finalizeSourceSwitchCleanup(task, {
        deletePlayRecord,
        deleteSkipConfig,
        saveSkipConfig,
      });
    },
    [pendingSourceSwitchCleanupRef],
  );

  return {
    handleSourceChange,
    handleLoadingTimeout,
    finalizePendingSourceSwitchCleanup,
  };
}
