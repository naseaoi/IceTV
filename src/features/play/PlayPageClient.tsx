'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PlayMainContent } from '@/features/play/components/PlayMainContent';
import {
  PlayErrorView,
  PlayLoadingView,
} from '@/features/play/components/PlayStateViews';
import { useArtPlayer } from '@/features/play/hooks/useArtPlayer';
import { useAuthRecovery } from '@/features/play/hooks/useAuthRecovery';
import { useAutoSwitchOnTimeoutSetting } from '@/features/play/hooks/useAutoSwitchOnTimeoutSetting';
import { useEpisodeSwitch } from '@/features/play/hooks/useEpisodeSwitch';
import { usePlayFavorite } from '@/features/play/hooks/usePlayFavorite';
import { updateVideoUrl, usePlayInit } from '@/features/play/hooks/usePlayInit';
import { usePlayPageState } from '@/features/play/hooks/usePlayPageState';
import { usePlayProgress } from '@/features/play/hooks/usePlayProgress';
import { useSkipConfig } from '@/features/play/hooks/useSkipConfig';
import { useSourceSwitch } from '@/features/play/hooks/useSourceSwitch';
import {
  peekResolvedLazyEpisodeUrl,
  prewarmLazyEpisodeUrl,
  resolveLazyEpisodeUrl,
} from '@/features/play/lib/lazyEpisode';
import { writePlayerInfo } from '@/features/play/lib/sourceProbeStore';
import { usePlaybackStatsReporter } from '@/features/playback-stats/hooks/usePlaybackStatsReporter';
import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';
import { clearSourceFailure } from '@/lib/failed-source-cooldown';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
import {
  destroyManagedHls,
  preloadPlayerModules,
  runManagedVideoCleanup,
} from '@/lib/player-runtime';
import { preloadProxyModes } from '@/lib/proxy-modes';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { SearchResult } from '@/lib/types';

const DIRECT_STARTUP_LOADING_DELAY_MS = 140;

export function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    preloadProxyModes();
    preloadPlayerModules();
  }, []);

  const state = usePlayPageState(searchParams);
  const {
    loading,
    setLoading,
    loadingStage,
    setLoadingStage,
    loadingMessage,
    setLoadingMessage,
    error,
    setError,
    detail,
    setDetail,
    favorited,
    setFavorited,
    setSkipConfig,
    skipConfigRef,
    lastSkipCheckRef,
    blockAdEnabled,
    setBlockAdEnabled,
    blockAdEnabledRef,
    videoTitle,
    setVideoTitle,
    videoYear,
    setVideoYear,
    videoCover,
    setVideoCover,
    videoDoubanId,
    setVideoDoubanId,
    currentSource,
    setCurrentSource,
    currentId,
    setCurrentId,
    searchTitle,
    searchType,
    needPreferRef,
    setNeedPrefer,
    currentEpisodeIndex,
    setCurrentEpisodeIndex,
    currentSourceRef,
    currentIdRef,
    videoTitleRef,
    videoYearRef,
    detailRef,
    currentEpisodeIndexRef,
    videoUrl,
    setVideoUrl,
    resumeTimeRef,
    resumeModeRef,
    allowAutoResumeRef,
    stableCurrentTimeRef,
    lastVolumeRef,
    lastPlaybackRateRef,
    availableSources,
    setAvailableSources,
    sourceSearchLoading,
    setSourceSearchLoading,
    sourceSearchError,
    setSourceSearchError,
    sourceChangeRequestIdRef,
    pendingSourceSwitchCleanupRef,
    sourceSwitchEpisodeAnchorRef,
    failedSourcesRef,
    autoFallbackInProgressRef,
    playbackRequestModeRef,
    optimizationEnabled,
    precomputedVideoInfo,
    setPrecomputedVideoInfo,
    clearTargetEpisodeProgressRef,
    isEpisodeSelectorCollapsed,
    setIsEpisodeSelectorCollapsed,
    isVideoLoading,
    setIsVideoLoading,
    setIsPlaying,
    videoLoadingStage,
    setVideoLoadingStage,
    videoLoadingAttempt,
    setVideoLoadingAttempt,
    playbackRetryNonce,
    setPlaybackRetryNonce,
    realtimeLoadSpeed,
    setRealtimeLoadSpeed,
    saveIntervalRef,
    lastSaveTimeRef,
    playProgressSaveStateRef,
    artPlayerRef,
    artRef,
    wakeLockRef,
  } = state;

  const totalEpisodes = detail?.episodes?.length || 0;
  const canDelayStartupLoading =
    !!currentSource && !!currentId && !needPreferRef.current;
  const [showStartupLoading, setShowStartupLoading] = useState(false);

  const autoSwitchSourceOnTimeout = useAutoSwitchOnTimeoutSetting();

  useEffect(() => {
    if (!loading) {
      setShowStartupLoading(false);
      return;
    }

    if (!canDelayStartupLoading) {
      setShowStartupLoading(true);
      return;
    }

    setShowStartupLoading(false);
    const timer = window.setTimeout(() => {
      setShowStartupLoading(true);
    }, DIRECT_STARTUP_LOADING_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [loading, canDelayStartupLoading]);

  const cleanupPlayer = useCallback(() => {
    const player = artPlayerRef.current;
    artPlayerRef.current = null;
    if (player) {
      try {
        if (player.video) {
          runManagedVideoCleanup(player.video);
          player.video.pause();
          player.video.removeAttribute('src');
          player.video.load();
          destroyManagedHls(player.video);
        }
        player.destroy();
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
      }
    }
  }, [artPlayerRef]);

  const { handleSkipConfigChange } = useSkipConfig({
    currentSource,
    currentId,
    currentSourceRef,
    currentIdRef,
    skipConfigRef,
    artPlayerRef,
    setSkipConfig,
  });

  useEffect(() => {
    if (!isVideoLoading && videoLoadingStage !== 'initing') {
      setVideoLoadingStage('initing');
    }
  }, [isVideoLoading, videoLoadingStage, setVideoLoadingStage]);

  usePlayInit({
    currentSource,
    currentId,
    videoTitle,
    searchTitle,
    searchType,
    needPreferRef,
    videoTitleRef,
    videoYearRef,
    currentEpisodeIndex,
    optimizationEnabled,
    setLoading,
    setLoadingStage,
    setLoadingMessage,
    setError,
    setDetail,
    setCurrentSource,
    setCurrentId,
    setVideoTitle,
    setVideoYear,
    setVideoCover,
    setVideoDoubanId,
    setCurrentEpisodeIndex,
    setNeedPrefer,
    setAvailableSources,
    setSourceSearchLoading,
    setSourceSearchError,
    setPrecomputedVideoInfo,
  });

  const {
    saveCurrentPlayProgress: doSaveCurrentProgress,
    savePlaybackCheckpoint: doSaveCheckpoint,
    requestWakeLock,
    releaseWakeLock,
  } = usePlayProgress({
    artPlayerRef,
    currentSourceRef,
    currentIdRef,
    videoTitleRef,
    detailRef,
    currentEpisodeIndexRef,
    resumeTimeRef,
    resumeModeRef,
    allowAutoResumeRef,
    stableCurrentTimeRef,
    clearTargetEpisodeProgressRef,
    saveStateRef: playProgressSaveStateRef,
    lastSaveTimeRef,
    saveIntervalRef,
    wakeLockRef,
    searchTitle,
    currentSource,
    currentId,
    currentEpisodeIndex,
    detail,
    setCurrentEpisodeIndex,
    cleanupPlayer,
  });

  const { startPlaybackStatsSession, reportPlaybackStats } =
    usePlaybackStatsReporter({
      artPlayerRef,
      currentSourceRef,
      currentIdRef,
      videoTitleRef,
      detailRef,
      currentEpisodeIndexRef,
      stableCurrentTimeRef,
    });

  const { handleEpisodeChange, handlePreviousEpisode, handleNextEpisode } =
    useEpisodeSwitch({
      detailRef,
      currentEpisodeIndexRef,
      resumeTimeRef,
      resumeModeRef,
      stableCurrentTimeRef,
      clearTargetEpisodeProgressRef,
      sourceSwitchEpisodeAnchorRef,
      playbackRequestModeRef,
      doSaveCurrentProgress,
      setError,
      setIsVideoLoading,
      setVideoLoadingStage,
      setVideoLoadingAttempt,
      setRealtimeLoadSpeed,
      setCurrentEpisodeIndex,
    });

  usePlayerKeyboard({
    artPlayerRef,
    episodeHandlers: {
      detailRef,
      currentEpisodeIndexRef,
      handlePreviousEpisode,
      handleNextEpisode,
    },
  });

  const { handleToggleFavorite } = usePlayFavorite({
    currentSource,
    currentId,
    searchTitle,
    videoTitleRef,
    detailRef,
    currentSourceRef,
    currentIdRef,
    favorited,
    setFavorited,
  });

  const {
    authRecoveryVisible,
    authRecoveryReasonMessage,
    dismissAuthRecovery,
    handleReloginAndRecover,
  } = useAuthRecovery({
    doSaveCheckpoint,
    setIsVideoLoading,
    setRealtimeLoadSpeed,
  });

  const {
    handleSourceChange,
    handleLoadingTimeout,
    finalizePendingSourceSwitchCleanup,
  } = useSourceSwitch({
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
  });

  const lastResolvedLazyEpisodeRef = useRef<{
    lazyUrl: string;
    url: string;
  } | null>(null);
  const videoUrlRef = useRef(videoUrl);

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  useEffect(() => {
    const episodes = detail?.episodes || [];
    const targetUrl =
      currentEpisodeIndex < episodes.length
        ? episodes[currentEpisodeIndex] || ''
        : '';
    const currentVideoUrl = videoUrlRef.current;

    if (!targetUrl || !isLazyEpisodeUrl(targetUrl)) {
      updateVideoUrl(detail, currentEpisodeIndex, currentVideoUrl, setVideoUrl);
      return;
    }

    const source = detail?.source || '';
    const nextLazyUrl = episodes[currentEpisodeIndex + 1] || '';
    const prewarmNext = () => {
      if (nextLazyUrl) prewarmLazyEpisodeUrl(source, nextLazyUrl);
    };

    const lastResolved = lastResolvedLazyEpisodeRef.current;
    if (
      currentVideoUrl &&
      lastResolved?.lazyUrl === targetUrl &&
      lastResolved.url === currentVideoUrl
    ) {
      return;
    }

    const cachedUrl = peekResolvedLazyEpisodeUrl(source, targetUrl);
    if (cachedUrl) {
      lastResolvedLazyEpisodeRef.current = {
        lazyUrl: targetUrl,
        url: cachedUrl,
      };
      if (cachedUrl !== currentVideoUrl) {
        setVideoUrl(cachedUrl);
      }
      prewarmNext();
      return;
    }

    let cancelled = false;
    setVideoUrl('');
    resolveLazyEpisodeUrl(source, targetUrl)
      .then((resolvedUrl) => {
        if (cancelled) return;
        lastResolvedLazyEpisodeRef.current = {
          lazyUrl: targetUrl,
          url: resolvedUrl,
        };
        setVideoUrl(resolvedUrl);
        prewarmNext();
      })
      .catch(() => {
        if (cancelled) return;
        handleLoadingTimeout();
        if (!autoSwitchSourceOnTimeout) {
          setRealtimeLoadSpeed('播放地址解析失败');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    autoSwitchSourceOnTimeout,
    currentEpisodeIndex,
    detail,
    handleLoadingTimeout,
    playbackRetryNonce,
    setRealtimeLoadSpeed,
    setVideoUrl,
  ]);

  const handleSourceDetailFetched = useCallback(
    (updated: SearchResult) => {
      setAvailableSources((prev) => mergeSourceBundle(prev, updated));
    },
    [setAvailableSources],
  );

  const handleAddSources = useCallback(
    (newSources: SearchResult[]) => {
      setAvailableSources((prev) => {
        const existingKeys = new Set(prev.map((s) => `${s.source}-${s.id}`));
        const unique = newSources.filter(
          (s) => !existingKeys.has(`${s.source}-${s.id}`),
        );
        return unique.length > 0 ? [...prev, ...unique] : prev;
      });
    },
    [setAvailableSources],
  );

  useArtPlayer({
    artRef,
    artPlayerRef,
    videoUrl,
    videoCover,
    videoTitle,
    loading,
    playbackRetryNonce,
    detail,
    currentEpisodeIndex,
    totalEpisodes,
    blockAdEnabled,
    blockAdEnabledRef,
    skipConfigRef,
    resumeTimeRef,
    resumeModeRef,
    allowAutoResumeRef,
    stableCurrentTimeRef,
    clearTargetEpisodeProgressRef,
    playbackRequestModeRef,
    lastVolumeRef,
    lastPlaybackRateRef,
    lastSkipCheckRef,
    lastSaveTimeRef,
    detailRef,
    currentEpisodeIndexRef,
    wakeLockRef,
    setError,
    setIsVideoLoading,
    setIsPlaying,
    setRealtimeLoadSpeed,
    setBlockAdEnabled,
    handleNextEpisode,
    handleSkipConfigChange,
    saveCurrentPlayProgress: doSaveCurrentProgress,
    reportPlaybackStats,
    startPlaybackStatsSession,
    requestWakeLock,
    releaseWakeLock,
    cleanupPlayer,
    onSourceProxyFallbackStarted: useCallback(() => {
      setVideoLoadingAttempt((prev) => prev + 1);
    }, [setVideoLoadingAttempt]),
    onPlaybackStarted: useCallback(() => {
      const activeSource = currentSourceRef.current;
      const activeId = currentIdRef.current;
      if (!activeSource || !activeId) {
        return;
      }

      autoFallbackInProgressRef.current = false;
      failedSourcesRef.current = new Set();
      clearSourceFailure(`${activeSource}-${activeId}`);
      sourceSwitchEpisodeAnchorRef.current = null;
      clearTargetEpisodeProgressRef.current = false;

      void finalizePendingSourceSwitchCleanup(activeSource, activeId);
    }, [
      finalizePendingSourceSwitchCleanup,
      currentSourceRef,
      currentIdRef,
      autoFallbackInProgressRef,
      failedSourcesRef,
      sourceSwitchEpisodeAnchorRef,
      clearTargetEpisodeProgressRef,
    ]),
    onCurrentSourceVideoInfo: useCallback(
      (
        info: { quality: string; loadSpeed: string; pingTime: number },
        context?: { source: string; id: string; videoUrl: string },
      ) => {
        const src = context?.source || currentSourceRef.current;
        const id = context?.id || currentIdRef.current;
        if (!src || !id) return;
        const key = `${src}-${id}`;
        writePlayerInfo(key, info);
        setPrecomputedVideoInfo((prev) => {
          const next = new Map(prev);
          next.set(key, info);
          return next;
        });
      },
      [currentSourceRef, currentIdRef, setPrecomputedVideoInfo],
    ),
  });

  useEffect(() => {
    return () => {
      reportPlaybackStats(true);
      doSaveCheckpoint();
      void doSaveCurrentProgress();
    };
  }, [reportPlaybackStats, doSaveCheckpoint, doSaveCurrentProgress]);

  const handleRetryPlayback = useCallback(() => {
    playbackRequestModeRef.current = 'episode';
    clearTargetEpisodeProgressRef.current = true;
    stableCurrentTimeRef.current = 0;
    resumeTimeRef.current = 0;
    resumeModeRef.current = null;
    setError(null);
    setIsVideoLoading(true);
    setVideoLoadingStage('episodeChanging');
    setVideoLoadingAttempt((prev) => prev + 1);
    setRealtimeLoadSpeed('正在切换剧集...');
    setPlaybackRetryNonce((prev) => prev + 1);
  }, [
    playbackRequestModeRef,
    clearTargetEpisodeProgressRef,
    stableCurrentTimeRef,
    resumeTimeRef,
    resumeModeRef,
    setError,
    setIsVideoLoading,
    setVideoLoadingStage,
    setVideoLoadingAttempt,
    setRealtimeLoadSpeed,
    setPlaybackRetryNonce,
  ]);

  const renderMainContent = (playbackError: string | null) => (
    <PlayMainContent
      videoTitle={videoTitle}
      totalEpisodes={totalEpisodes}
      detail={detail}
      currentEpisodeIndex={currentEpisodeIndex}
      isEpisodeSelectorCollapsed={isEpisodeSelectorCollapsed}
      setIsEpisodeSelectorCollapsed={setIsEpisodeSelectorCollapsed}
      artRef={artRef}
      isVideoLoading={isVideoLoading}
      videoLoadingStage={videoLoadingStage}
      videoLoadingAttempt={videoLoadingAttempt}
      realtimeLoadSpeed={realtimeLoadSpeed}
      authRecoveryVisible={authRecoveryVisible}
      authRecoveryReasonMessage={authRecoveryReasonMessage}
      onReloginAndRecover={handleReloginAndRecover}
      onDismissAuthRecovery={dismissAuthRecovery}
      onEpisodeChange={handleEpisodeChange}
      onRetryPlayback={handleRetryPlayback}
      onSourceChange={handleSourceChange}
      currentSource={currentSource}
      currentId={currentId}
      searchTitle={searchTitle}
      availableSources={availableSources}
      sourceSearchLoading={sourceSearchLoading}
      sourceSearchError={sourceSearchError}
      precomputedVideoInfo={precomputedVideoInfo}
      videoYear={videoYear}
      favorited={favorited}
      onToggleFavorite={handleToggleFavorite}
      videoCover={videoCover}
      videoDoubanId={videoDoubanId}
      onSourceDetailFetched={handleSourceDetailFetched}
      onAddSources={handleAddSources}
      onLoadingTimeout={handleLoadingTimeout}
      searchType={searchType}
      playbackError={playbackError}
    />
  );

  if (loading) {
    if (!showStartupLoading) return null;

    return (
      <PlayLoadingView
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
        onBack={() => router.back()}
      />
    );
  }

  if (error) {
    if (detail) {
      return renderMainContent(error);
    }
    return (
      <PlayErrorView
        error={error}
        onBack={() => window.history.back()}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return renderMainContent(null);
}
