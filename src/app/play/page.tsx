'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect } from 'react';

import {
  deletePlayRecord,
  deleteSkipConfig,
  getSkipConfig,
  saveSkipConfig,
} from '@/lib/db.client';
import {
  destroyManagedHls,
  preloadPlayerModules,
  runManagedVideoCleanup,
} from '@/lib/player-runtime';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { SearchResult, SkipConfig } from '@/lib/types';
import { preloadProxyModes } from '@/lib/proxy-modes';
import {
  clearSourceFailure,
  markSourceFailed,
} from '@/lib/failed-source-cooldown';

import { PlayMainContent } from '@/features/play/components/PlayMainContent';
import { useArtPlayer } from '@/features/play/hooks/useArtPlayer';
import { useAuthRecovery } from '@/features/play/hooks/useAuthRecovery';
import { useAutoSwitchOnTimeoutSetting } from '@/features/play/hooks/useAutoSwitchOnTimeoutSetting';
import { useEpisodeSwitch } from '@/features/play/hooks/useEpisodeSwitch';
import { usePlayFavorite } from '@/features/play/hooks/usePlayFavorite';
import { usePlayInit, updateVideoUrl } from '@/features/play/hooks/usePlayInit';
import { usePlayPageState } from '@/features/play/hooks/usePlayPageState';
import { writePlayerInfo } from '@/features/play/lib/sourceProbeStore';
import {
  PlayErrorView,
  PlayLoadingView,
} from '@/features/play/components/PlayStateViews';
import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';
import { resolveEpisodeTargetIndex } from '@/features/play/lib/episodeMapping';
import {
  resolveSourceSwitchEpisodeAnchor,
  resolveSourceSwitchCurrentPlayTime,
  resolveSourceSwitchResumeState,
} from '@/features/play/lib/episodeResumePolicy';
import { formatTimeSimple } from '@/features/play/lib/formatTime';
import { savePlayIntent } from '@/features/play/lib/playIntent';
import { usePlayProgress } from '@/features/play/hooks/usePlayProgress';
import {
  finalizeSourceSwitchCleanup,
  shouldFinalizeSourceSwitchCleanup,
} from '@/features/play/lib/sourceSwitchCleanup';

function PlayPageClient() {
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
    skipConfig,
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
    optimizationEnabled,
    precomputedVideoInfo,
    setPrecomputedVideoInfo,
    clearTargetEpisodeProgressRef,
    isEpisodeSelectorCollapsed,
    setIsEpisodeSelectorCollapsed,
    isVideoLoading,
    setIsVideoLoading,
    isPlaying,
    setIsPlaying,
    videoLoadingStage,
    setVideoLoadingStage,
    videoLoadingAttempt,
    setVideoLoadingAttempt,
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

  const autoSwitchSourceOnTimeout = useAutoSwitchOnTimeoutSetting();

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

  const handleSkipConfigChange = useCallback(
    async (newConfig: {
      enable: boolean;
      intro_time: number;
      outro_time: number;
    }) => {
      if (!currentSourceRef.current || !currentIdRef.current) return;

      try {
        setSkipConfig(newConfig);
        if (
          !newConfig.enable &&
          !newConfig.intro_time &&
          !newConfig.outro_time
        ) {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current,
          );
          const updateSetting = artPlayerRef.current?.setting.update.bind(
            artPlayerRef.current.setting,
          );
          if (updateSetting) {
            updateSetting({
              name: '跳过片头片尾',
              html: '跳过片头片尾',
              switch: skipConfigRef.current.enable,
              onSwitch(item: { switch?: boolean }) {
                const cfg = { ...skipConfigRef.current, enable: !item.switch };
                handleSkipConfigChange(cfg);
                return !item.switch;
              },
            } as Parameters<typeof updateSetting>[0]);
            updateSetting({
              name: '设置片头',
              html: '设置片头',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0
                  ? '设置片头时间'
                  : `${formatTimeSimple(skipConfigRef.current.intro_time)}`,
              onClick: function () {
                const currentTime = artPlayerRef.current?.currentTime || 0;
                if (currentTime > 0) {
                  const cfg = {
                    ...skipConfigRef.current,
                    intro_time: currentTime,
                  };
                  handleSkipConfigChange(cfg);
                  return `${formatTimeSimple(currentTime)}`;
                }
              },
            } as Parameters<typeof updateSetting>[0]);
            updateSetting({
              name: '设置片尾',
              html: '设置片尾',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.outro_time >= 0
                  ? '设置片尾时间'
                  : `-${formatTimeSimple(-skipConfigRef.current.outro_time)}`,
              onClick: function () {
                const outroTime =
                  -(
                    (artPlayerRef.current?.duration ?? 0) -
                    (artPlayerRef.current?.currentTime ?? 0)
                  ) || 0;
                if (outroTime < 0) {
                  const cfg = {
                    ...skipConfigRef.current,
                    outro_time: outroTime,
                  };
                  handleSkipConfigChange(cfg);
                  return `-${formatTimeSimple(-outroTime)}`;
                }
              },
            } as Parameters<typeof updateSetting>[0]);
          }
        } else {
          await saveSkipConfig(
            currentSourceRef.current,
            currentIdRef.current,
            newConfig,
          );
        }
      } catch (err) {
        console.error('保存跳过片头片尾配置失败:', err);
      }
    },
    [
      artPlayerRef,
      currentSourceRef,
      currentIdRef,
      setSkipConfig,
      skipConfigRef,
    ],
  );

  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex, videoUrl, setVideoUrl);
  }, [detail, currentEpisodeIndex]);

  useEffect(() => {
    if (!isVideoLoading && videoLoadingStage === 'sourceChanging') {
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

  useEffect(() => {
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;
      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) setSkipConfig(config);
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };
    initSkipConfig();
  }, []);

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

  const { handleEpisodeChange, handlePreviousEpisode, handleNextEpisode } =
    useEpisodeSwitch({
      detailRef,
      currentEpisodeIndexRef,
      resumeTimeRef,
      resumeModeRef,
      stableCurrentTimeRef,
      clearTargetEpisodeProgressRef,
      sourceSwitchEpisodeAnchorRef,
      doSaveCurrentProgress,
      setIsVideoLoading,
      setVideoLoadingStage,
      setVideoLoadingAttempt,
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

  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string,
    options?: { isAutoFallback?: boolean },
  ) => {
    if (
      newSource === currentSourceRef.current &&
      newId === currentIdRef.current
    ) {
      return;
    }

    const isAutoFallback = options?.isAutoFallback === true;

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
      setRealtimeLoadSpeed('测速中...');
      setError(null);

      if (artPlayerRef.current) {
        try {
          artPlayerRef.current.pause();
        } catch (err) {
          console.warn('换源时暂停当前视频失败:', err);
        }
      }

      let newDetail = targetSource;

      try {
        const detailRes = await fetch(
          `/api/detail?source=${newSource}&id=${newId}`,
        );
        if (currentRequestId !== sourceChangeRequestIdRef.current) {
          return;
        }
        if (detailRes.ok) {
          const fullDetail = (await detailRes.json()) as SearchResult;
          if (fullDetail.episodes && fullDetail.episodes.length > 0) {
            newDetail = fullDetail;
            setAvailableSources((prev) => mergeSourceBundle(prev, fullDetail));
          }
        }
      } catch (err) {
        console.error('换源刷新详情失败:', err);
      }

      if (currentRequestId !== sourceChangeRequestIdRef.current) {
        return;
      }

      const latestEpisodeIndex = currentEpisodeIndexRef.current;
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
        !isAutoFallback &&
        !preserveProgress &&
        !clearTargetEpisodeProgress &&
        episodeAnchor.episodeIndex > 0
      ) {
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

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newDetail.source);
      newUrl.searchParams.set('id', newDetail.id);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newDetail.source);
      setCurrentId(newDetail.id);
      setDetail(newDetail);
      currentEpisodeIndexRef.current = targetIndex;
      setCurrentEpisodeIndex(targetIndex);

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
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

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

  const parseLoadSpeedKBps = (speed?: string): number => {
    if (!speed) return 0;
    const match = speed.match(/^([\d.]+)\s*(Mbps|Mb\/s|KB\/s|MB\/s)$/);
    if (!match) return 0;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value <= 0) return 0;
    const unit = match[2];
    if (unit === 'Mbps' || unit === 'Mb/s') return (value * 1024) / 8;
    if (unit === 'MB/s') return value * 1024;
    return value;
  };

  const handleLoadingTimeout = useCallback(() => {
    if (!autoSwitchSourceOnTimeout) {
      return;
    }

    const curSource = currentSourceRef.current;
    const curId = currentIdRef.current;
    const curDetail = detailRef.current;
    const curEpisodeIndex = currentEpisodeIndexRef.current;
    if (!curSource || !curId) return;

    const curKey = `${curSource}-${curId}`;
    failedSourcesRef.current.add(curKey);
    markSourceFailed(curKey);

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
    if (candidates.length === 0) return;

    const ranked = [...candidates].sort((a, b) => {
      const aInfo = precomputedVideoInfo.get(`${a.source}-${a.id}`);
      const bInfo = precomputedVideoInfo.get(`${b.source}-${b.id}`);
      const aSpeed = parseLoadSpeedKBps(aInfo?.loadSpeed);
      const bSpeed = parseLoadSpeedKBps(bInfo?.loadSpeed);
      return bSpeed - aSpeed;
    });
    const next = ranked[0];
    if (!next) return;

    autoFallbackInProgressRef.current = true;
    void handleSourceChange(next.source, next.id, next.title, {
      isAutoFallback: true,
    });
  }, [
    autoSwitchSourceOnTimeout,
    availableSources,
    precomputedVideoInfo,
    currentSourceRef,
    currentIdRef,
    detailRef,
    currentEpisodeIndexRef,
    failedSourcesRef,
    sourceSwitchEpisodeAnchorRef,
    autoFallbackInProgressRef,
  ]);

  useArtPlayer({
    artRef,
    artPlayerRef,
    videoUrl,
    videoCover,
    videoTitle,
    loading,
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
      (info: { quality: string; loadSpeed: string; pingTime: number }) => {
        const src = currentSourceRef.current;
        const id = currentIdRef.current;
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
      doSaveCheckpoint();
      void doSaveCurrentProgress();
    };
  }, [doSaveCheckpoint, doSaveCurrentProgress]);

  if (loading) {
    return (
      <PlayLoadingView
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
        onBack={() => router.back()}
      />
    );
  }

  if (error) {
    return (
      <PlayErrorView
        error={error}
        videoTitle={videoTitle}
        onBack={() => window.history.back()}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <PlayMainContent
      videoTitle={videoTitle}
      totalEpisodes={totalEpisodes}
      detail={detail}
      currentEpisodeIndex={currentEpisodeIndex}
      isEpisodeSelectorCollapsed={isEpisodeSelectorCollapsed}
      setIsEpisodeSelectorCollapsed={setIsEpisodeSelectorCollapsed}
      artRef={artRef}
      isVideoLoading={isVideoLoading}
      isPlaying={isPlaying}
      videoLoadingStage={videoLoadingStage}
      videoLoadingAttempt={videoLoadingAttempt}
      realtimeLoadSpeed={realtimeLoadSpeed}
      authRecoveryVisible={authRecoveryVisible}
      authRecoveryReasonMessage={authRecoveryReasonMessage}
      onReloginAndRecover={handleReloginAndRecover}
      onDismissAuthRecovery={dismissAuthRecovery}
      onEpisodeChange={handleEpisodeChange}
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
    />
  );
}

function PlayPageContent() {
  const searchParams = useSearchParams();

  return <PlayPageClient key={searchParams.toString()} />;
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <PlayLoadingView
          loadingStage='searching'
          loadingMessage='正在搜索播放源...'
          onBack={() => window.history.back()}
        />
      }
    >
      <PlayPageContent />
    </Suspense>
  );
}
