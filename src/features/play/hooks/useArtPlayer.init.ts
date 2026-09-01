import type { MutableRefObject } from 'react';

import type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';
import { resolveNextStablePlaybackTime } from '@/features/play/hooks/usePlayProgress';
import {
  createArtPlayerContextmenus,
  createArtPlayerControls,
  createArtPlayerSettings,
} from '@/features/play/lib/artPlayerSettings';
import {
  isTrustworthyPlaybackEnd,
  shouldAutoAdvanceEpisode,
} from '@/features/play/lib/autoAdvanceEpisode';
import {
  createDanmakuPluginIfEnabled,
  reloadDanmaku,
} from '@/features/play/lib/danmaku/attach';
import { createDanmakuSettings } from '@/features/play/lib/danmaku/settings';
import {
  type PlayerLoadingSessionState,
  hasReachedResumeTarget,
  markPlayerLoadingSessionStarted,
  resetPlayerLoadingSessionState,
  shouldDismissLoadingFromCanPlay,
  shouldDismissLoadingFromReadyFrame,
} from '@/features/play/lib/playerLoading';
import { filterAdsFromM3U8 } from '@/features/play/lib/playUtils';
import {
  applyResumeTime,
  isWithinAutoResumeWindow,
  resolvePendingResumeTime,
  resolveResumeTimeTarget,
  shouldForcePlaybackStartFromHead,
} from '@/features/play/lib/resumePlayback';
import { createVodM3u8Loader } from '@/features/play/lib/vodHlsRuntime';
import {
  buildVodProxyUrl,
  buildVodSegmentProxyUrl,
  isVodM3u8Url,
  isVodMp4Url,
} from '@/features/play/lib/vodProxyUrl';
import {
  bindPlayerHoverControls,
  bindPlayerMobileControls,
  createHlsLoaderClass,
  getManagedVideo,
  getPlayerModules,
  isPlayerFastForwarding,
  prefetchM3U8,
  restorePlayerPlaybackRate,
} from '@/lib/player-runtime';
import {
  configureArtplayerStatics,
  createArtPlayerConfig,
  ensureVideoSource,
  formatTime,
  showTimedArtNotice,
} from '@/lib/player-utils';
import { preconnectForUrl } from '@/lib/preconnect';
import {
  clearSourceProxyOverride,
  isServerProxy,
  rememberSourceServerProxy,
  shouldAutoFallbackToServer,
} from '@/lib/proxy-modes';
import { reportSourceRouteStat } from '@/lib/source-route-stats.client';

interface UseArtPlayerInitState {
  loadingSessionRef: MutableRefObject<PlayerLoadingSessionState>;
  autoAdvanceArmedRef: MutableRefObject<boolean>;
  autoAdvancedRef: MutableRefObject<boolean>;
  playerMediaKindRef: MutableRefObject<'hls' | 'native' | null>;
  sessionEpisodeIndexRef: MutableRefObject<number | null>;
  isCancelled: () => boolean;
}

export async function initializeArtPlayer(
  params: UseArtPlayerParams,
  state: UseArtPlayerInitState,
) {
  const {
    artRef,
    artPlayerRef,
    videoUrl,
    videoTitle,
    detail,
    currentEpisodeIndex,
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
    setError,
    setIsVideoLoading,
    setIsPlaying,
    setRealtimeLoadSpeed,
    setBlockAdEnabled,
    handleNextEpisode,
    handleSkipConfigChange,
    saveCurrentPlayProgress,
    reportPlaybackStats,
    startPlaybackStatsSession,
    requestWakeLock,
    releaseWakeLock,
    cleanupPlayer,
    onPlaybackStarted,
    onSourceProxyFallbackStarted,
    onCurrentSourceVideoInfo,
  } = params;
  const {
    loadingSessionRef,
    autoAdvanceArmedRef,
    autoAdvancedRef,
    playerMediaKindRef,
    sessionEpisodeIndexRef,
    isCancelled,
  } = state;

  try {
    const preSourceKey = detailRef.current?.source || '';
    const mediaKind = isVodM3u8Url(videoUrl) ? 'hls' : 'native';
    const playbackInfoContext = {
      source: detailRef.current?.source || detail?.source || '',
      id: detailRef.current?.id || detail?.id || '',
      videoUrl,
    };
    const danmakuContext = {
      source: playbackInfoContext.source,
      videoId: playbackInfoContext.id,
      episodeIndex: currentEpisodeIndex,
      searchTitle: detailRef.current?.title || detail?.title || videoTitle,
    };
    const preUseProxy = isServerProxy(preSourceKey, videoUrl);
    const buildProxyUrl = (rawUrl: string) =>
      buildVodProxyUrl({
        rawUrl,
        useServerProxy: preUseProxy,
        sourceKey: preSourceKey,
        playbackRequestMode: playbackRequestModeRef.current || 'initial',
      });
    const buildSegmentProxyUrl = (rawUrl: string) =>
      buildVodSegmentProxyUrl({
        rawUrl,
        sourceKey: preSourceKey,
        playbackRequestMode: playbackRequestModeRef.current || 'initial',
      });
    const resolvePlaybackUrl = (rawUrl: string) =>
      mediaKind === 'hls' || !preUseProxy
        ? rawUrl
        : buildSegmentProxyUrl(rawUrl);
    const playbackUrl = resolvePlaybackUrl(videoUrl);

    if (mediaKind === 'hls') {
      prefetchM3U8(buildProxyUrl(videoUrl));
    }
    preconnectForUrl(videoUrl);

    const nextEpisodeUrl = detail?.episodes?.[currentEpisodeIndex + 1] ?? null;
    if (nextEpisodeUrl) {
      if (isVodM3u8Url(nextEpisodeUrl)) {
        prefetchM3U8(buildProxyUrl(nextEpisodeUrl));
      }
      preconnectForUrl(nextEpisodeUrl);
    }

    const { Artplayer, Hls } = await getPlayerModules();
    if (isCancelled() || !artRef.current) {
      return;
    }

    sessionEpisodeIndexRef.current = currentEpisodeIndex;

    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as unknown as Record<string, unknown>)
        .webkitConvertPointFromNodeToPage === 'function';

    if (
      !isWebkit &&
      artPlayerRef.current &&
      mediaKind === 'hls' &&
      playerMediaKindRef.current === mediaKind
    ) {
      const carriedResumeTarget = resolvePendingResumeTime({
        resumeTime: resumeTimeRef.current,
        resumeMode: resumeModeRef.current,
        allowAutoResume: allowAutoResumeRef.current,
      });
      resetPlayerLoadingSessionState(loadingSessionRef.current);
      // 复用播放器时 Artplayer 会在 loadedmetadata 把进度归零，这里保留未落地的
      // 恢复点，交给 timeupdate/progress 重试逻辑再次 seek。
      if (carriedResumeTarget !== null) {
        loadingSessionRef.current.pendingInitialResumeTarget =
          carriedResumeTarget;
      }
      restorePlayerPlaybackRate(
        artPlayerRef.current,
        lastPlaybackRateRef.current,
      );
      const reusedPlayer = artPlayerRef.current;
      reusedPlayer.switch = playbackUrl;
      reusedPlayer.title = `${videoTitle} - 第${currentEpisodeIndex + 1}集`;
      // switch 内部会注册一次性的归零回调，这里紧随其后注册以立即纠正落点，
      // 避免等重试逻辑生效时出现可见的回跳。
      if (carriedResumeTarget !== null) {
        reusedPlayer.once?.('video:loadedmetadata', () => {
          if (artPlayerRef.current !== reusedPlayer) {
            return;
          }
          applyResumeTime(reusedPlayer, carriedResumeTarget);
        });
      }
      if (reusedPlayer.video) {
        ensureVideoSource(reusedPlayer.video as HTMLVideoElement, playbackUrl);
      }
      void reloadDanmaku(reusedPlayer, danmakuContext);
      return;
    }

    if (artPlayerRef.current) {
      cleanupPlayer();
    }
    resetPlayerLoadingSessionState(loadingSessionRef.current);

    const adBlockingHlsLoader = createHlsLoaderClass(
      Hls.DefaultConfig.loader as unknown as new (config: unknown) => {
        load: (...args: unknown[]) => void;
      },
      {
        transformManifestText: (content) => filterAdsFromM3U8(content),
      },
    );

    const m3u8Loader = createVodM3u8Loader({
      Hls,
      adBlockingHlsLoader,
      artPlayerRef,
      blockAdEnabledRef,
      detailRef,
      playbackInfoContext,
      playbackRequestModeRef,
      resumeTimeRef,
      resumeModeRef,
      stableCurrentTimeRef,
      loadingSessionRef,
      setError,
      setIsVideoLoading,
      setRealtimeLoadSpeed,
      onSourceProxyFallbackStarted,
      onCurrentSourceVideoInfo,
    });

    configureArtplayerStatics(Artplayer);
    Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

    const danmakuPlugin = await createDanmakuPluginIfEnabled(danmakuContext);
    if (isCancelled() || !artRef.current) {
      return;
    }

    artPlayerRef.current = new Artplayer({
      container: artRef.current,
      url: playbackUrl,
      ...createArtPlayerConfig({
        isLive: false,
        setting: true,
        playbackRate: true,
        aspectRatio: true,
        screenshot: true,
        fastForward: false,
      }),
      type: mediaKind === 'native' && isVodMp4Url(videoUrl) ? 'mp4' : '',
      customType: {
        m3u8: m3u8Loader,
      },
      settings: [
        ...createArtPlayerSettings({
          artPlayerRef,
          blockAdEnabled,
          autoPlayNextEnabled,
          autoPlayNextEnabledRef,
          skipConfigRef,
          resumeTimeRef,
          resumeModeRef,
          setBlockAdEnabled,
          setAutoPlayNextEnabled,
          handleSkipConfigChange,
        }),
        ...createDanmakuSettings(() => artPlayerRef.current, danmakuContext),
      ],
      controls: createArtPlayerControls({
        handleNextEpisode,
      }),
      contextmenu: createArtPlayerContextmenus(),
      ...(danmakuPlugin ? { plugins: [danmakuPlugin] } : {}),
    });

    const player = artPlayerRef.current;
    if (!player) {
      return;
    }

    playerMediaKindRef.current = mediaKind;
    bindPlayerHoverControls(player);
    bindPlayerMobileControls(player);
    let nativeUseServerProxy = mediaKind === 'native' && preUseProxy;
    let nativeFallbackStarted = false;
    const nativeRouteStatReported = {
      browser: { success: false, failure: false },
      server: { success: false, failure: false },
    };
    const reportNativeRouteStat = (success: boolean) => {
      if (mediaKind !== 'native' || !preSourceKey) return;
      const mode = nativeUseServerProxy ? 'server' : 'browser';
      const state = nativeRouteStatReported[mode];
      if (success) {
        if (state.success) return;
        state.success = true;
      } else {
        if (state.failure) return;
        state.failure = true;
      }
      reportSourceRouteStat(preSourceKey, mode, success);
    };

    if (mediaKind === 'native' && player.video) {
      getManagedVideo(
        player.video as HTMLVideoElement,
      ).__icetvUsingServerProxy = nativeUseServerProxy;
    }

    const switchNativeToServerProxy = (reason: string) => {
      if (
        mediaKind !== 'native' ||
        nativeUseServerProxy ||
        !preSourceKey ||
        !shouldAutoFallbackToServer(preSourceKey)
      ) {
        return false;
      }

      const fallbackUrl = buildSegmentProxyUrl(videoUrl);
      console.warn('原生视频直连起播失败，切换服务端代理重试', {
        sourceKey: preSourceKey,
        reason,
      });
      reportNativeRouteStat(false);

      if (preSourceKey) {
        rememberSourceServerProxy(preSourceKey, videoUrl);
      }
      nativeUseServerProxy = true;
      nativeFallbackStarted = true;
      setRealtimeLoadSpeed('直连失败，切换代理...');
      setIsVideoLoading(true);
      onSourceProxyFallbackStarted?.();

      try {
        player.switch = fallbackUrl;
        const activeVideo = player.video as HTMLVideoElement | undefined;
        if (activeVideo) {
          const managedVideo = getManagedVideo(activeVideo);
          managedVideo.__icetvUsingServerProxy = true;
          ensureVideoSource(activeVideo, fallbackUrl);
          void activeVideo.play().catch(() => {});
        }
        return true;
      } catch (error) {
        console.error('切换原生视频服务端代理失败:', error);
        return false;
      }
    };

    const resolveDeclaredDuration = (): number | null => {
      const activeVideo = player.video as HTMLVideoElement | null;
      if (!activeVideo) return null;
      const hls = getManagedVideo(activeVideo).hls;
      const level = hls?.levels?.[hls.currentLevel];
      const total = level?.details?.totalduration;
      return Number.isFinite(total) && (total ?? 0) > 0
        ? (total as number)
        : null;
    };

    const tryAutoAdvanceEpisode = () => {
      const currentDetail = detailRef.current;
      const episodeIndex = currentEpisodeIndexRef.current;
      if (
        !shouldAutoAdvanceEpisode({
          enabled: autoPlayNextEnabledRef.current,
          armed: autoAdvanceArmedRef.current,
          alreadyAdvanced: autoAdvancedRef.current,
          currentEpisodeIndex: episodeIndex,
          episodeCount: currentDetail?.episodes?.length ?? 0,
        })
      ) {
        return false;
      }
      autoAdvancedRef.current = true;
      restorePlayerPlaybackRate(player, lastPlaybackRateRef.current);
      handleNextEpisode();
      return true;
    };

    const updateStableCurrentTime = (time: number) => {
      stableCurrentTimeRef.current = resolveNextStablePlaybackTime(
        time,
        stableCurrentTimeRef.current,
        clearTargetEpisodeProgressRef.current,
      );
    };

    const resetPlaybackToStartIfNeeded = () => {
      const shouldResetToStart =
        clearTargetEpisodeProgressRef.current ||
        shouldForcePlaybackStartFromHead({
          resumeTime: resumeTimeRef.current,
          resumeMode: resumeModeRef.current,
        });

      if (!shouldResetToStart) {
        return false;
      }

      try {
        player.currentTime = 0;
      } catch (error) {
        console.warn('重置目标集起播位置失败:', error);
      }

      stableCurrentTimeRef.current = 0;
      loadingSessionRef.current.pendingInitialResumeTarget = 0;
      return true;
    };

    const showSourceSwitchSuccessNotice = () => {
      const mode = playbackRequestModeRef.current;
      if (mode !== 'manual-source') {
        return;
      }

      const activeDetail = detailRef.current;
      const sourceName =
        activeDetail?.source_name ||
        activeDetail?.source?.toString() ||
        '当前源';
      const playTime = Math.max(
        player.currentTime || 0,
        stableCurrentTimeRef.current || 0,
      );
      const progressText = playTime > 1 ? '已保留进度' : '从头播放';
      const prefix = '已切换到';
      const notice = `${prefix} ${sourceName} · ${progressText}`;

      window.setTimeout(() => {
        if (artPlayerRef.current !== player) {
          return;
        }
        try {
          showTimedArtNotice(player, notice);
        } catch (error) {
          console.warn('显示换源成功提示失败:', error);
        }
      }, 50);
    };

    const notifyPlayerPlaybackStarted = () => {
      const activeVideo = player.video as HTMLVideoElement | undefined;
      const activeSourceKey = detailRef.current?.source || '';
      if (activeVideo && activeSourceKey) {
        const activeManagedVideo = getManagedVideo(activeVideo);
        if (activeManagedVideo.__icetvUsingServerProxy === false) {
          clearSourceProxyOverride(activeSourceKey, videoUrl);
        }
      }
      reportNativeRouteStat(true);
      showSourceSwitchSuccessNotice();
      startPlaybackStatsSession?.();
      onPlaybackStarted?.();
      playbackRequestModeRef.current = 'initial';
    };

    /**
     * 被新一轮初始化取代的播放会话不得消费恢复点：复用播放器时旧回调仍绑定在
     * 同一个实例上，若不识别会把下一集的进度当成本集的用掉。
     */
    const isStalePlayerSession = () =>
      artPlayerRef.current !== player ||
      (sessionEpisodeIndexRef.current !== null &&
        sessionEpisodeIndexRef.current !== currentEpisodeIndexRef.current);

    const finishInitialLoading = () => {
      if (isStalePlayerSession()) {
        return;
      }

      if (!markPlayerLoadingSessionStarted(loadingSessionRef.current)) {
        return;
      }

      resumeTimeRef.current = null;
      resumeModeRef.current = null;
      autoAdvanceArmedRef.current = true;
      setIsVideoLoading(false);
      setRealtimeLoadSpeed('');
      notifyPlayerPlaybackStarted();
    };

    let initialPlaybackRequestInFlight = false;
    const requestInitialPlayback = (
      video: HTMLVideoElement | null | undefined,
    ) => {
      if (!video || initialPlaybackRequestInFlight) {
        return;
      }

      initialPlaybackRequestInFlight = true;
      getManagedVideo(video).hls?.startLoad?.();
      void video
        .play()
        .then(() => {
          finishInitialLoading();
        })
        .catch((error) => {
          initialPlaybackRequestInFlight = false;
          if (
            error instanceof DOMException &&
            error.name === 'NotAllowedError' &&
            shouldDismissLoadingFromReadyFrame(video)
          ) {
            finishInitialLoading();
            getManagedVideo(video).hls?.stopLoad?.();
            return;
          }
          console.warn('自动起播失败:', error);
        });
    };

    let lastPendingResumeSeekAt = 0;

    const completePendingResumeIfReady = () => {
      if (
        !hasReachedResumeTarget(
          player.currentTime || 0,
          loadingSessionRef.current.pendingInitialResumeTarget,
        )
      ) {
        return false;
      }

      loadingSessionRef.current.pendingInitialResumeTarget = null;
      finishInitialLoading();
      return true;
    };

    const retryPendingResumePosition = () => {
      const target = loadingSessionRef.current.pendingInitialResumeTarget;
      if (!Number.isFinite(target) || (target ?? 0) <= 0) {
        return false;
      }

      if (hasReachedResumeTarget(player.currentTime || 0, target)) {
        return false;
      }

      const now = performance.now();
      if (now - lastPendingResumeSeekAt < 500) {
        return false;
      }

      try {
        const safeTarget = resolveResumeTimeTarget(
          target as number,
          player.duration,
        );
        if (safeTarget <= 0) {
          return false;
        }
        loadingSessionRef.current.pendingInitialResumeTarget = safeTarget;
        if (applyResumeTime(player, safeTarget)) {
          lastPendingResumeSeekAt = now;
          stableCurrentTimeRef.current = safeTarget;
          return true;
        }
      } catch (error) {
        console.warn('重试恢复播放进度失败:', error);
      }

      return false;
    };

    const finishLoadingFromPlaybackStarted = () => {
      finishInitialLoading();
    };

    const ensureInitialPlaybackPosition = () => {
      if (isStalePlayerSession()) {
        return null;
      }

      if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
        return loadingSessionRef.current.pendingInitialResumeTarget;
      }

      let appliedResumeTarget: number | null = null;
      let intendedResumeTarget: number | null = null;
      const pendingResumeTime = resolvePendingResumeTime({
        resumeTime: resumeTimeRef.current,
        resumeMode: resumeModeRef.current,
        allowAutoResume: allowAutoResumeRef.current,
      });

      if (pendingResumeTime !== null) {
        intendedResumeTarget = pendingResumeTime;
        try {
          const safeResumeTarget = resolveResumeTimeTarget(
            pendingResumeTime,
            player.duration,
          );
          if (
            safeResumeTarget > 0 &&
            applyResumeTime(player, safeResumeTarget)
          ) {
            appliedResumeTarget = safeResumeTarget;
            lastPendingResumeSeekAt = performance.now();
          }
          if (resumeModeRef.current === 'history') {
            allowAutoResumeRef.current = false;
          }
        } catch (error) {
          console.warn('恢复播放进度失败:', error);
        }
      } else if (resetPlaybackToStartIfNeeded()) {
        appliedResumeTarget = 0;
        intendedResumeTarget = 0;
      }

      // 记录“想去的位置”而不是“已落地的位置”：时长未知导致 seek 失败时，
      // 仍需保留目标供后续重试，否则恢复点会被永久丢弃。
      const trackedResumeTarget =
        appliedResumeTarget !== null
          ? appliedResumeTarget
          : intendedResumeTarget;
      loadingSessionRef.current.pendingInitialResumeTarget =
        trackedResumeTarget;
      const fallbackTime =
        intendedResumeTarget !== null
          ? intendedResumeTarget
          : player.currentTime || 0;
      updateStableCurrentTime(fallbackTime);

      return trackedResumeTarget;
    };

    const finishInitialLoadingIfMediaReady = () => {
      if (isStalePlayerSession()) {
        return;
      }

      ensureInitialPlaybackPosition();

      const activeVideo = player.video as HTMLVideoElement | null;
      const isPlayingReady = shouldDismissLoadingFromCanPlay(activeVideo);
      if (isPlayingReady) {
        finishLoadingFromPlaybackStarted();
      }

      const hasReadyFrame = shouldDismissLoadingFromReadyFrame(activeVideo);
      if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
        if (!completePendingResumeIfReady()) {
          retryPendingResumePosition();
        }
        if (!isPlayingReady && hasReadyFrame) {
          requestInitialPlayback(activeVideo);
        }
        return;
      }

      if (hasReadyFrame) {
        requestInitialPlayback(activeVideo);
      }
    };

    player.on('ready', () => {
      setError(null);
      if (player.playing) {
        void requestWakeLock();
      }
    });

    player.on('play', () => {
      const activeVideo = player.video as HTMLVideoElement | undefined;
      if (activeVideo) {
        getManagedVideo(activeVideo).hls?.startLoad?.();
      }
      void requestWakeLock();
      setIsPlaying(true);
    });

    player.on('video:playing', () => {
      ensureInitialPlaybackPosition();
      finishLoadingFromPlaybackStarted();
      if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
        retryPendingResumePosition();
      }
    });

    player.on('pause', () => {
      void releaseWakeLock();
      saveCurrentPlayProgress();
      reportPlaybackStats?.(true);
      setIsPlaying(false);
    });

    player.on('video:ended', () => {
      void releaseWakeLock();
      reportPlaybackStats?.(true);
      setIsPlaying(false);
      restorePlayerPlaybackRate(player, lastPlaybackRateRef.current);
      if (
        !isTrustworthyPlaybackEnd(
          player.currentTime || 0,
          resolveDeclaredDuration(),
        )
      ) {
        console.warn('忽略异常提前触发的播放结束事件');
        return;
      }
      tryAutoAdvanceEpisode();
    });

    if (player.playing) {
      void requestWakeLock();
    }

    player.on('video:volumechange', () => {
      lastVolumeRef.current = player.volume;
    });

    player.on('video:ratechange', () => {
      if (isPlayerFastForwarding(player)) {
        return;
      }
      lastPlaybackRateRef.current = player.playbackRate as number;
    });

    player.on('video:canplay', () => {
      ensureInitialPlaybackPosition();

      setTimeout(() => {
        if (Math.abs(player.volume - lastVolumeRef.current) > 0.01) {
          player.volume = lastVolumeRef.current;
        }
        if (
          Math.abs(
            (player.playbackRate as number) - lastPlaybackRateRef.current,
          ) > 0.01 &&
          isWebkit
        ) {
          player.playbackRate = lastPlaybackRateRef.current as
            | 0.5
            | 0.75
            | 1
            | 1.25
            | 1.5
            | 1.75
            | 2;
        }
        if (!loadingSessionRef.current.playbackStartNotified) {
          player.notice.show = '';
        }
      }, 0);

      finishInitialLoadingIfMediaReady();
    });

    player.on('video:loadeddata', finishInitialLoadingIfMediaReady);
    player.on('video:progress', finishInitialLoadingIfMediaReady);

    player.on('video:timeupdate', () => {
      updateStableCurrentTime(player.currentTime || 0);

      if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
        completePendingResumeIfReady();
      }

      if (shouldDismissLoadingFromCanPlay(player.video)) {
        finishLoadingFromPlaybackStarted();
      }

      const duration = player.duration || 0;
      const currentTime = player.currentTime || 0;
      if (
        duration > 0 &&
        currentTime > 0 &&
        duration - currentTime <= 0.4 &&
        loadingSessionRef.current.pendingInitialResumeTarget === null
      ) {
        if (tryAutoAdvanceEpisode()) {
          return;
        }
      }

      if (allowAutoResumeRef.current) {
        if (!isWithinAutoResumeWindow(player.currentTime || 0)) {
          allowAutoResumeRef.current = false;
          if (resumeModeRef.current === 'history') {
            resumeTimeRef.current = null;
            resumeModeRef.current = null;
          }
        }
      }

      if (!skipConfigRef.current.enable) {
        return;
      }

      const skipCurrentTime = player.currentTime || 0;
      const skipDuration = player.duration || 0;
      const now = Date.now();

      if (now - lastSkipCheckRef.current < 1500) {
        return;
      }
      lastSkipCheckRef.current = now;

      if (
        skipConfigRef.current.intro_time > 0 &&
        skipCurrentTime < skipConfigRef.current.intro_time
      ) {
        player.currentTime = skipConfigRef.current.intro_time;
        player.notice.show = `已跳过片头 (${formatTime(skipConfigRef.current.intro_time)})`;
      }

      if (
        skipConfigRef.current.outro_time < 0 &&
        skipDuration > 0 &&
        skipCurrentTime > player.duration + skipConfigRef.current.outro_time
      ) {
        if (!tryAutoAdvanceEpisode()) {
          player.pause();
        }
        player.notice.show = `已跳过片尾 (${formatTime(skipConfigRef.current.outro_time)})`;
      }
    });

    player.on('error', (error: Error) => {
      console.error('播放器错误:', error);
      if (player.currentTime > 0) {
        return;
      }
      reportNativeRouteStat(false);
      if (
        mediaKind === 'native' &&
        !nativeFallbackStarted &&
        switchNativeToServerProxy(error.message || 'player-error')
      ) {
        return;
      }
      const activeVideo = player.video as HTMLVideoElement | undefined;
      const activeManagedVideo = activeVideo
        ? getManagedVideo(activeVideo)
        : null;
      if (
        activeManagedVideo?.__icetvSwitchToServerProxy?.(
          error.message || 'player-error',
        )
      ) {
        return;
      }
    });

    player.on('video:timeupdate', () => {
      const now = Date.now();
      if (now - lastSaveTimeRef.current > 5000) {
        saveCurrentPlayProgress();
      }
      reportPlaybackStats?.();
    });

    player.on('video:seeking', () => {
      updateStableCurrentTime(player.currentTime || 0);
    });

    player.on('video:seeked', () => {
      updateStableCurrentTime(player.currentTime || 0);
      if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
        completePendingResumeIfReady();
      }
    });

    if (player.video) {
      ensureVideoSource(player.video as HTMLVideoElement, playbackUrl);
    }

    window.setTimeout(finishInitialLoadingIfMediaReady, 0);
    window.setTimeout(finishInitialLoadingIfMediaReady, 500);
  } catch (error) {
    console.error('创建播放器失败:', error);
    setError('播放器初始化失败');
  }
}
