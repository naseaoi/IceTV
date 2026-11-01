'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import { PlayMainContent } from '@/features/play/components/PlayMainContent';
import {
  PlayErrorView,
  PlayLoadingView,
} from '@/features/play/components/PlayStateViews';
import { useArtPlayer } from '@/features/play/hooks/useArtPlayer';
import { useAuthRecovery } from '@/features/play/hooks/useAuthRecovery';
import { useDanmakuPreference } from '@/features/play/hooks/useDanmakuPreference';
import { useDanmakuWarmup } from '@/features/play/hooks/useDanmakuWarmup';
import { useEpisodeSwitch } from '@/features/play/hooks/useEpisodeSwitch';
import { usePlayFavorite } from '@/features/play/hooks/usePlayFavorite';
import { updateVideoUrl, usePlayInit } from '@/features/play/hooks/usePlayInit';
import { usePlayPageState } from '@/features/play/hooks/usePlayPageState';
import { usePlayProgress } from '@/features/play/hooks/usePlayProgress';
import { useSkipConfig } from '@/features/play/hooks/useSkipConfig';
import { useSourcePlaybackStatsRecorder } from '@/features/play/hooks/useSourcePlaybackStatsRecorder';
import { useSourceSwitch } from '@/features/play/hooks/useSourceSwitch';
import {
  applyDanmakuHeatmapVisibility,
  ensureDanmakuLoaded,
  reloadDanmaku,
} from '@/features/play/lib/danmaku/attach';
import { fragmentMemoryCache } from '@/features/play/lib/fragmentMemoryCache';
import {
  peekResolvedLazyEpisodeUrl,
  prewarmLazyEpisodeUrl,
  resolveLazyEpisodeUrl,
} from '@/features/play/lib/lazyEpisode';
import { cancelNextEpisodePreload } from '@/features/play/lib/nextEpisodePreload';
import { writePlayerInfo } from '@/features/play/lib/sourceProbeStore';
import { getVodRuntimeSourceUrl } from '@/features/play/lib/vodHlsRuntime';
import { usePlaybackStatsReporter } from '@/features/playback-stats/hooks/usePlaybackStatsReporter';
import { useBackNavigation } from '@/hooks/useBackNavigation';
import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
import {
  destroyManagedHls,
  preloadPlayerModules,
  runManagedVideoCleanup,
} from '@/lib/player-runtime';
import { destroyArtPlayer } from '@/lib/player-utils';
import { preloadProxyModes } from '@/lib/proxy-modes';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { SearchResult } from '@/lib/types';

const DIRECT_STARTUP_LOADING_DELAY_MS = 140;

function readInitialAggregateGroupLength() {
  if (typeof window === 'undefined') return 0;

  try {
    const raw = window.sessionStorage.getItem('aggregate_group');
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function AuthenticatedPlayPageClient({
  initialDanmakuEnabled,
}: {
  initialDanmakuEnabled: boolean | null;
}) {
  const searchParams = useSearchParams();
  const goBack = useBackNavigation('/');

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
    autoPlayNextEnabled,
    setAutoPlayNextEnabled,
    autoPlayNextEnabledRef,
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
    playbackRequestModeRef,
    optimizationEnabled,
    precomputedVideoInfo,
    setPrecomputedVideoInfo,
    sourceRecommendation,
    setSourceRecommendation,
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
    historyRestoreGateRef,
    artPlayerRef,
    artRef,
    wakeLockRef,
  } = state;

  const {
    enabledRef: danmakuEnabledRef,
    onEnabledChange: onDanmakuEnabledChange,
  } = useDanmakuPreference(initialDanmakuEnabled);
  useDanmakuWarmup({
    enabledRef: danmakuEnabledRef,
    title: videoTitle || searchTitle,
  });

  const totalEpisodes = detail?.episodes?.length || 0;
  const [isSingleAggregateStartup] = useState(
    () =>
      searchParams.get('singleSource') === 'true' ||
      (needPreferRef.current && readInitialAggregateGroupLength() === 1),
  );
  const [isDirectStartup] = useState(
    () => searchParams.get('directStart') === 'true',
  );
  const shouldHideStartupLoading = isSingleAggregateStartup || isDirectStartup;
  const canDelayStartupLoading =
    (!!currentSource && !!currentId && !needPreferRef.current) ||
    shouldHideStartupLoading;
  const [showStartupLoading, setShowStartupLoading] = useState(false);
  const dismissSourceRecommendation = useCallback(() => {
    setSourceRecommendation(null);
  }, [setSourceRecommendation]);

  useEffect(() => {
    if (!loading) {
      setShowStartupLoading(false);
      return;
    }

    if (shouldHideStartupLoading) {
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
  }, [loading, canDelayStartupLoading, shouldHideStartupLoading]);

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
        destroyArtPlayer(player);
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

  const playbackStartedSourceRef = useRef<Pick<
    SearchResult,
    'source' | 'id'
  > | null>(null);

  usePlayInit({
    currentSource,
    currentId,
    currentSourceRef,
    currentIdRef,
    playbackStartedSourceRef,
    videoTitle,
    searchTitle,
    searchType,
    needPreferRef,
    videoTitleRef,
    videoYearRef,
    currentEpisodeIndex,
    optimizationEnabled,
    historyRestoreGateRef,
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
    setSourceRecommendation,
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
    historyRestoreGateRef,
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
      artPlayerRef,
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

  const { recordPlaybackStarted, recordPlaybackFailed } =
    useSourcePlaybackStatsRecorder({
      sourceKey: currentSource,
      videoId: currentId,
      episodeIndex: currentEpisodeIndex,
      videoUrl,
    });

  const videoUrlRef = useRef(videoUrl);

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  const {
    handleSourceChange,
    handleLoadingTimeout,
    handlePlaybackRecoveryExhausted,
    handleEpisodeUrlResolveFailed,
    resetAutoSourceSwitch,
    finalizePendingSourceSwitchCleanup,
    stopActiveHlsLoading,
    restartCurrentPlayback,
    showPendingPlaybackNotice,
  } = useSourceSwitch({
    availableSources,
    precomputedVideoInfo,
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
    pendingSourceSwitchCleanupRef,
    sourceChangeRequestIdRef,
    videoUrlRef,
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
    setPlaybackRetryNonce,
    setRealtimeLoadSpeed,
    setSourceSearchError,
    cleanupPlayer,
    onPlaybackStartFailed: recordPlaybackFailed,
  });

  // 换集开启新的播放意图，自动换源的失败记录和次数随之清零
  const handleEpisodeChangeRequest = useCallback(
    (episodeNumber: number) => {
      resetAutoSourceSwitch();
      handleEpisodeChange(episodeNumber);
    },
    [handleEpisodeChange, resetAutoSourceSwitch],
  );
  const handlePreviousEpisodeRequest = useCallback(() => {
    resetAutoSourceSwitch();
    handlePreviousEpisode();
  }, [handlePreviousEpisode, resetAutoSourceSwitch]);
  const handleNextEpisodeRequest = useCallback(() => {
    resetAutoSourceSwitch();
    handleNextEpisode();
  }, [handleNextEpisode, resetAutoSourceSwitch]);

  usePlayerKeyboard({
    artPlayerRef,
    episodeHandlers: {
      detailRef,
      currentEpisodeIndexRef,
      handlePreviousEpisode: handlePreviousEpisodeRequest,
      handleNextEpisode: handleNextEpisodeRequest,
    },
  });

  const lastResolvedLazyEpisodeRef = useRef<{
    lazyUrl: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    // 起播放行前不派生地址：历史恢复可能还要改集，提前派生会让播放器和逐集解析先按当前集白跑一遍
    if (loading) return;

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
    // 换源开始即作废本次解析，新源的地址由提交后的详情重新触发
    const sourceChangeRequestId = sourceChangeRequestIdRef.current;
    const isStale = () =>
      cancelled || sourceChangeRequestId !== sourceChangeRequestIdRef.current;
    // 清空地址前停掉上一集的运行时，否则等待解析期间它的超时回退和恢复逻辑仍会作用到新集
    stopActiveHlsLoading();
    setVideoUrl('');
    resolveLazyEpisodeUrl(source, targetUrl)
      .then((resolvedUrl) => {
        if (isStale()) return;
        lastResolvedLazyEpisodeRef.current = {
          lazyUrl: targetUrl,
          url: resolvedUrl,
        };
        setVideoUrl(resolvedUrl);
        prewarmNext();
      })
      .catch(() => {
        if (isStale()) return;
        handleEpisodeUrlResolveFailed();
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentEpisodeIndex,
    detail,
    handleEpisodeUrlResolveFailed,
    loading,
    playbackRetryNonce,
    setVideoUrl,
    sourceChangeRequestIdRef,
    stopActiveHlsLoading,
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

  const getCurrentDanmakuContext = useCallback(() => {
    return {
      source: currentSourceRef.current,
      videoId: currentIdRef.current,
      episodeIndex: currentEpisodeIndexRef.current,
      searchTitle: detailRef.current?.title || videoTitleRef.current || '',
      searchYear: videoYearRef.current || detailRef.current?.year || '',
    };
  }, [
    currentSourceRef,
    currentIdRef,
    currentEpisodeIndexRef,
    detailRef,
    videoTitleRef,
    videoYearRef,
  ]);

  const handleDanmakuEnable = useCallback(() => {
    void ensureDanmakuLoaded(
      artPlayerRef.current,
      getCurrentDanmakuContext(),
      danmakuEnabledRef,
    );
  }, [artPlayerRef, danmakuEnabledRef, getCurrentDanmakuContext]);

  const handleDanmakuReload = useCallback(
    (options?: { refreshData?: boolean }) => {
      return reloadDanmaku(
        artPlayerRef.current,
        getCurrentDanmakuContext(),
        danmakuEnabledRef,
        {
          forcePluginReload: true,
          refreshData: options?.refreshData !== false,
        },
      );
    },
    [artPlayerRef, danmakuEnabledRef, getCurrentDanmakuContext],
  );

  const handleDanmakuHeatmapChange = useCallback(
    (enabled: boolean) => {
      applyDanmakuHeatmapVisibility(
        artPlayerRef.current,
        danmakuEnabledRef.current,
        enabled,
      );
    },
    [artPlayerRef, danmakuEnabledRef],
  );

  useArtPlayer({
    artRef,
    artPlayerRef,
    videoUrl,
    videoCover,
    videoTitle,
    loading,
    isVideoLoading,
    playbackRetryNonce,
    detail,
    currentEpisodeIndex,
    totalEpisodes,
    blockAdEnabled,
    blockAdEnabledRef,
    autoPlayNextEnabled,
    autoPlayNextEnabledRef,
    setAutoPlayNextEnabled,
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
    handleNextEpisode: handleNextEpisodeRequest,
    handleSkipConfigChange,
    saveCurrentPlayProgress: doSaveCurrentProgress,
    reportPlaybackStats,
    startPlaybackStatsSession,
    requestWakeLock,
    releaseWakeLock,
    cleanupPlayer,
    danmakuEnabledRef,
    onDanmakuEnabledChange,
    onDanmakuEnable: handleDanmakuEnable,
    onSourceProxyFallbackStarted: useCallback(() => {
      setVideoLoadingAttempt((prev) => prev + 1);
    }, [setVideoLoadingAttempt]),
    onPlaybackRecoveryExhausted: handlePlaybackRecoveryExhausted,
    onPlaybackStarted: useCallback(() => {
      const activeSource = currentSourceRef.current;
      const activeId = currentIdRef.current;
      if (!activeSource || !activeId) {
        return;
      }

      // 只把当前地址的起播记为该源成功并登记为已起播：运行时已释放或登记的是别的地址时，起播来自被放弃的旧地址
      const activeVideo = artPlayerRef.current?.video;
      const activeVideoUrl = videoUrlRef.current;
      if (
        activeVideoUrl &&
        activeVideo &&
        getVodRuntimeSourceUrl(activeVideo) === activeVideoUrl
      ) {
        playbackStartedSourceRef.current = {
          source: activeSource,
          id: activeId,
        };
        recordPlaybackStarted();
      }
      sourceSwitchEpisodeAnchorRef.current = null;
      clearTargetEpisodeProgressRef.current = false;
      showPendingPlaybackNotice();

      void finalizePendingSourceSwitchCleanup(activeSource, activeId);
    }, [
      finalizePendingSourceSwitchCleanup,
      recordPlaybackStarted,
      showPendingPlaybackNotice,
      artPlayerRef,
      currentSourceRef,
      currentIdRef,
      videoUrlRef,
      playbackStartedSourceRef,
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

  // 下一集预载和分片缓存是模块级单例，页面内换集、换源和播放器重建都要沿用，只在离开播放页时释放
  useEffect(() => {
    return () => {
      cancelNextEpisodePreload();
      fragmentMemoryCache.clear();
    };
  }, []);

  const handleRetryPlayback = useCallback(() => {
    resetAutoSourceSwitch();
    playbackRequestModeRef.current = 'episode';
    setVideoLoadingStage('episodeChanging');
    setRealtimeLoadSpeed('正在切换剧集...');
    restartCurrentPlayback();
  }, [
    resetAutoSourceSwitch,
    playbackRequestModeRef,
    setVideoLoadingStage,
    setRealtimeLoadSpeed,
    restartCurrentPlayback,
  ]);

  const renderMainContent = (playbackError: string | null) => (
    <PlayMainContent
      videoTitle={videoTitle}
      totalEpisodes={totalEpisodes}
      detail={detail}
      detailLoading={loading && !detail}
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
      onEpisodeChange={handleEpisodeChangeRequest}
      onRetryPlayback={handleRetryPlayback}
      onSourceChange={handleSourceChange}
      currentSource={currentSource}
      currentId={currentId}
      searchTitle={searchTitle}
      availableSources={availableSources}
      sourceSearchLoading={sourceSearchLoading}
      sourceSearchError={sourceSearchError}
      precomputedVideoInfo={precomputedVideoInfo}
      sourceRecommendation={sourceRecommendation}
      onDismissSourceRecommendation={dismissSourceRecommendation}
      videoYear={videoYear}
      favorited={favorited}
      onToggleFavorite={handleToggleFavorite}
      videoCover={videoCover}
      videoDoubanId={videoDoubanId}
      onSourceDetailFetched={handleSourceDetailFetched}
      onAddSources={handleAddSources}
      onDanmakuReload={handleDanmakuReload}
      onDanmakuHeatmapChange={handleDanmakuHeatmapChange}
      onLoadingTimeout={handleLoadingTimeout}
      searchType={searchType}
      playbackError={playbackError}
    />
  );

  if (loading) {
    if (shouldHideStartupLoading) {
      return renderMainContent(null);
    }

    if (!showStartupLoading) return null;

    return (
      <PlayLoadingView
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
        onBack={goBack}
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
        onBack={goBack}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return renderMainContent(null);
}

export function PlayPageClient({
  initialDanmakuEnabled = null,
}: {
  initialDanmakuEnabled?: boolean | null;
} = {}) {
  return (
    <AuthenticatedRoute
      activePath='/play'
      contentMode='player'
      message='请先登录后再播放内容。'
    >
      <AuthenticatedPlayPageClient
        initialDanmakuEnabled={initialDanmakuEnabled}
      />
    </AuthenticatedRoute>
  );
}
