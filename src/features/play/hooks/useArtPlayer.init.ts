import type { MutableRefObject } from 'react';

import type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';
import { resolveNextStablePlaybackTime } from '@/features/play/hooks/usePlayProgress';
import { filterM3U8AdsForSource } from '@/features/play/lib/ad-segment-detector';
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
  bindDanmakuSettingPersistence,
  createDanmakuPluginIfEnabled,
  isDanmakuFeatureEnabled,
  reloadDanmaku,
} from '@/features/play/lib/danmaku/attach';
import {
  beginDanmakuLoadNotice,
  waitForDanmakuPlayerSwitch,
} from '@/features/play/lib/danmaku/load-notice';
import { bindDanmakuSliderDrag } from '@/features/play/lib/danmaku/slider-drag';
import { prewarmLazyEpisodeUrl } from '@/features/play/lib/lazyEpisode';
import { scheduleNextEpisodePreload } from '@/features/play/lib/nextEpisodePreload';
import {
  type PlayerLoadingSessionState,
  hasReachedResumeTarget,
  markPlayerLoadingSessionStarted,
  registerStartupStateDescriber,
  resetPlayerLoadingSessionState,
  shouldDismissLoadingFromCanPlay,
  shouldDismissLoadingFromReadyFrame,
} from '@/features/play/lib/playerLoading';
import {
  applyResumeTime,
  isWithinAutoResumeWindow,
  resolvePendingResumeTime,
  resolveResumeTimeTarget,
  shouldForcePlaybackStartFromHead,
} from '@/features/play/lib/resumePlayback';
import {
  createVodM3u8Loader,
  getVodRuntimeSourceUrl,
  pauseIfVodRuntimeReleased,
  registerVodNativeRuntime,
} from '@/features/play/lib/vodHlsRuntime';
import {
  createVodPlaybackIntent,
  getVodSourceAttempt,
} from '@/features/play/lib/vodPlaybackIntent';
import {
  buildVodProxyUrl,
  buildVodSegmentProxyUrl,
  isVodM3u8Url,
  isVodMp4Url,
} from '@/features/play/lib/vodProxyUrl';
import { isLazyEpisodeUrl } from '@/lib/lazy-episodes';
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
  type SourcePlaybackRoute,
  clearSourceProxyOverride,
  rememberSourceServerProxy,
  resolveSourcePlaybackRoute,
} from '@/lib/proxy-modes';
import { reportSourceRouteStat } from '@/lib/source-route-stats.client';

interface UseArtPlayerInitState {
  loadingSessionRef: MutableRefObject<PlayerLoadingSessionState>;
  autoAdvanceArmedRef: MutableRefObject<boolean>;
  autoAdvancedRef: MutableRefObject<boolean>;
  playerMediaKindRef: MutableRefObject<'hls' | 'native' | null>;
  sessionEpisodeIndexRef: MutableRefObject<number | null>;
  playbackRouteRef: MutableRefObject<SourcePlaybackRoute | null>;
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
    startPlaybackStatsSession,
    handlePlaybackStatsEvent,
    requestWakeLock,
    releaseWakeLock,
    cleanupPlayer,
    danmakuEnabledRef,
    onDanmakuEnabledChange,
    onPlaybackStarted,
    onDanmakuEnable,
    onSourceProxyFallbackStarted,
    playbackIntentRef,
    onPlaybackRecoveryExhausted,
    onCurrentSourceVideoInfo,
  } = params;
  const {
    loadingSessionRef,
    autoAdvanceArmedRef,
    autoAdvancedRef,
    playerMediaKindRef,
    sessionEpisodeIndexRef,
    playbackRouteRef,
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
    const playbackRoute = await resolveSourcePlaybackRoute(
      preSourceKey,
      videoUrl,
    );
    if (isCancelled() || !artRef.current) return;
    let currentEpisodeIndex = currentEpisodeIndexRef.current;
    const danmakuContext = {
      source: playbackInfoContext.source,
      videoId: playbackInfoContext.id,
      episodeIndex: currentEpisodeIndex,
      searchTitle: detailRef.current?.title || detail?.title || videoTitle,
      searchYear: detailRef.current?.year || detail?.year || '',
    };
    const preUseProxy = playbackRoute.useServerProxy;
    const buildProxyUrl = (rawUrl: string) =>
      buildVodProxyUrl({
        rawUrl,
        ...playbackRoute,
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
      prefetchM3U8(buildProxyUrl(videoUrl), playbackRoute);
    }
    preconnectForUrl(videoUrl);

    const nextEpisodeUrl =
      detailRef.current?.episodes?.[currentEpisodeIndex + 1] ?? null;
    const nextManifestPrefetchUrl =
      nextEpisodeUrl && isVodM3u8Url(nextEpisodeUrl)
        ? buildProxyUrl(nextEpisodeUrl)
        : null;
    scheduleNextEpisodePreload({
      sourceKey: preSourceKey,
      videoId: playbackInfoContext.id,
      episodeIndex: currentEpisodeIndex,
      nextEpisodeUrl,
      getVideo: () => artPlayerRef.current?.video,
      detailRef,
      currentEpisodeIndexRef,
      autoPlayNextEnabledRef,
      blockAdEnabledRef,
      skipConfigRef,
      warmUp: (signal) => {
        if (!nextEpisodeUrl) return;
        if (isLazyEpisodeUrl(nextEpisodeUrl)) {
          prewarmLazyEpisodeUrl(preSourceKey, nextEpisodeUrl, signal);
          return;
        }
        if (nextManifestPrefetchUrl) {
          prefetchM3U8(nextManifestPrefetchUrl, playbackRoute);
        }
        preconnectForUrl(nextEpisodeUrl);
      },
    });

    const { Artplayer, Hls } = await getPlayerModules();
    if (isCancelled() || !artRef.current) {
      return;
    }

    currentEpisodeIndex = currentEpisodeIndexRef.current;
    danmakuContext.episodeIndex = currentEpisodeIndex;
    playbackRouteRef.current = playbackRoute;
    sessionEpisodeIndexRef.current = currentEpisodeIndex;

    const registerStartupDiagnostics = (
      targetPlayer: NonNullable<typeof artPlayerRef.current>,
      extra?: () => Record<string, unknown>,
    ) => {
      const targetVideo = targetPlayer.video as HTMLVideoElement | undefined;
      if (!targetVideo) return;
      registerStartupStateDescriber(targetVideo, 'session', () => ({
        playerActive: targetPlayer === artPlayerRef.current,
        pendingInitialResumeTarget:
          loadingSessionRef.current.pendingInitialResumeTarget,
        playbackStartNotified: loadingSessionRef.current.playbackStartNotified,
        sessionEpisodeIndex: sessionEpisodeIndexRef.current,
        currentEpisodeIndex: currentEpisodeIndexRef.current,
        runtimeUrlMatches: getVodRuntimeSourceUrl(targetVideo) === videoUrl,
        runtimeRegistered: getVodRuntimeSourceUrl(targetVideo) !== null,
        resumeTime: resumeTimeRef.current,
        resumeMode: resumeModeRef.current,
        allowAutoResume: allowAutoResumeRef.current,
        usingServerProxy: getManagedVideo(targetVideo).__icetvUsingServerProxy,
        mediaKind,
        ...extra?.(),
      }));
    };

    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as unknown as Record<string, unknown>)
        .webkitConvertPointFromNodeToPage === 'function';

    if (
      !isWebkit &&
      artPlayerRef.current &&
      // art.url 读的是 video.src，MSE 下是 blob: 地址；option.url 才是上次交给播放器的地址
      artPlayerRef.current.option.url !== playbackUrl &&
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
      registerStartupDiagnostics(reusedPlayer, () => ({
        initPath: 'reused',
        carriedResumeTarget,
      }));
      waitForDanmakuPlayerSwitch(
        reusedPlayer,
        reusedPlayer.switchUrl(playbackUrl),
      );
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
      void reloadDanmaku(reusedPlayer, danmakuContext, danmakuEnabledRef);
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
        transformManifestText: (content, _context, manifestUrl) =>
          filterM3U8AdsForSource(
            content,
            manifestUrl,
            detailRef.current?.source,
          ),
      },
    );

    const m3u8Loader = createVodM3u8Loader({
      Hls,
      adBlockingHlsLoader,
      artPlayerRef,
      blockAdEnabledRef,
      detailRef,
      playbackInfoContext,
      playbackRouteRef,
      playbackRequestModeRef,
      resumeTimeRef,
      resumeModeRef,
      allowAutoResumeRef,
      stableCurrentTimeRef,
      loadingSessionRef,
      setError,
      setIsVideoLoading,
      setRealtimeLoadSpeed,
      onSourceProxyFallbackStarted,
      playbackIntentRef,
      onPlaybackRecoveryExhausted,
      onCurrentSourceVideoInfo,
    });

    configureArtplayerStatics(Artplayer);
    Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

    const danmakuPlugin = await createDanmakuPluginIfEnabled(
      danmakuContext,
      danmakuEnabledRef,
    );
    if (isCancelled() || !artRef.current) {
      return;
    }

    sessionEpisodeIndexRef.current = currentEpisodeIndexRef.current;
    danmakuContext.episodeIndex = currentEpisodeIndexRef.current;
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
      settings: createArtPlayerSettings({
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
    // 内置倍速设置在 ratechange 时按当前倍速查选项，快捷键 0.1 步进的倍速不在列表里会查到 null 并直接 check 崩溃
    const setting = player.setting as
      | { check?: (target: unknown) => void }
      | undefined;
    const checkSetting = setting?.check?.bind(setting);
    if (setting && checkSetting) {
      setting.check = (target) => {
        if (target) checkSetting(target);
      };
    }
    if (
      !danmakuPlugin &&
      isDanmakuFeatureEnabled() &&
      danmakuEnabledRef.current
    ) {
      beginDanmakuLoadNotice(
        player,
        () => danmakuEnabledRef.current,
      )({ status: 'error' });
    }

    playerMediaKindRef.current = mediaKind;
    bindPlayerHoverControls(player);
    bindPlayerMobileControls(player);
    let nativeUseServerProxy = mediaKind === 'native' && preUseProxy;
    const nativeIntent =
      playbackIntentRef?.current ?? createVodPlaybackIntent();
    const nativeAttempt =
      mediaKind === 'native'
        ? getVodSourceAttempt(
            nativeIntent,
            preSourceKey,
            detailRef.current?.id || '',
          )
        : null;
    if (nativeAttempt) {
      nativeAttempt.allowAutoFallback = playbackRoute.allowAutoFallback;
      nativeAttempt.triedRoutes.add(
        nativeUseServerProxy ? 'server' : 'browser',
      );
    }
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
      // 必须在创建后同步登记：未登记的播放器按已释放处理，起播和出错回退都不会再响应
      registerVodNativeRuntime(
        player.video as HTMLVideoElement,
        videoUrl,
        nativeIntent,
      );
    }

    const switchNativeToServerProxy = (reason: string) => {
      if (
        mediaKind !== 'native' ||
        artPlayerRef.current !== player ||
        getVodRuntimeSourceUrl(player.video as HTMLVideoElement) !== videoUrl ||
        !nativeAttempt ||
        nativeAttempt.routeSwitched ||
        (playbackIntentRef && playbackIntentRef.current !== nativeIntent) ||
        navigator.onLine === false ||
        !preSourceKey ||
        !playbackRoute.allowAutoFallback
      ) {
        return false;
      }

      const nextServer = !nativeUseServerProxy;
      const fallbackUrl = nextServer
        ? buildSegmentProxyUrl(videoUrl)
        : videoUrl;
      console.warn('原生视频直连起播失败，切换服务端代理重试', {
        sourceKey: preSourceKey,
        reason,
      });
      reportNativeRouteStat(false);

      nativeUseServerProxy = nextServer;
      nativeAttempt.routeSwitched = true;
      nativeAttempt.triedRoutes.add(nextServer ? 'server' : 'browser');
      setRealtimeLoadSpeed('直连失败，切换代理...');
      setIsVideoLoading(true);
      onSourceProxyFallbackStarted?.();

      try {
        waitForDanmakuPlayerSwitch(player, player.switchUrl(fallbackUrl));
        const activeVideo = player.video as HTMLVideoElement | undefined;
        if (activeVideo) {
          const managedVideo = getManagedVideo(activeVideo);
          managedVideo.__icetvUsingServerProxy = nextServer;
          ensureVideoSource(activeVideo, fallbackUrl);
          void activeVideo.play().catch(() => {});
        }
        return true;
      } catch (error) {
        console.error('切换原生视频服务端代理失败:', error);
        return false;
      }
    };

    if (mediaKind === 'native' && player.video) {
      getManagedVideo(
        player.video as HTMLVideoElement,
      ).__icetvSwitchToServerProxy = switchNativeToServerProxy;
    }

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
      if (mode !== 'manual-source' && mode !== 'auto-source') {
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
      const prefix = mode === 'auto-source' ? '已自动切换到' : '已切换到';
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

    const reportPlayerRouteStarted = () => {
      if (
        mediaKind !== 'native' ||
        nativeRouteStatReported[nativeUseServerProxy ? 'server' : 'browser']
          .success
      )
        return;
      const activeVideo = player.video as HTMLVideoElement | undefined;
      const activeSourceKey = detailRef.current?.source || '';
      if (activeVideo && activeSourceKey) {
        const activeManagedVideo = getManagedVideo(activeVideo);
        if (
          mediaKind === 'native' &&
          activeManagedVideo.__icetvUsingServerProxy === false
        ) {
          clearSourceProxyOverride(activeSourceKey, videoUrl);
        }
      }
      if (
        mediaKind === 'native' &&
        nativeUseServerProxy &&
        nativeAttempt?.routeSwitched
      )
        rememberSourceServerProxy(preSourceKey, videoUrl);
      reportNativeRouteStat(true);
    };

    const notifyPlayerPlaybackStarted = () => {
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
      (mediaKind === 'native' &&
        playbackIntentRef &&
        playbackIntentRef.current !== nativeIntent) ||
      (sessionEpisodeIndexRef.current !== null &&
        sessionEpisodeIndexRef.current !== currentEpisodeIndexRef.current) ||
      // 换源开始或逐集解析停旧集时运行时已释放，视频上仍是被放弃的旧地址，它的就绪和起播不能当作本次加载完成
      getVodRuntimeSourceUrl(player.video as HTMLVideoElement) === null;

    const finishInitialLoading = (playing = false) => {
      if (isStalePlayerSession()) {
        return;
      }

      const firstStart = markPlayerLoadingSessionStarted(
        loadingSessionRef.current,
      );
      if (!firstStart && !playing) return;
      // 线路恢复仍需收起加载层并记录新线路成功，源起播通知每个加载会话只发一次。
      setIsVideoLoading(false);
      setRealtimeLoadSpeed('');
      reportPlayerRouteStarted();
      if (!firstStart) return;

      resumeTimeRef.current = null;
      resumeModeRef.current = null;
      autoAdvanceArmedRef.current = true;
      notifyPlayerPlaybackStarted();
    };

    let initialPlaybackRequestInFlight = false;
    // hls 仍在加载时再 startLoad 会中止在途分片并从头重下，只在加载被停掉时补拉
    const resumeHlsLoadingIfStopped = (video: HTMLVideoElement) => {
      const hls = getManagedVideo(video).hls;
      if (hls && !hls.loadingEnabled) hls.startLoad();
    };
    const requestInitialPlayback = (
      video: HTMLVideoElement | null | undefined,
    ) => {
      if (!video || initialPlaybackRequestInFlight) {
        return;
      }

      initialPlaybackRequestInFlight = true;
      resumeHlsLoadingIfStopped(video);
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
    registerStartupDiagnostics(player, () => ({
      initPath: 'created',
      staleSession: isStalePlayerSession(),
      initialPlaybackRequestInFlight,
      msSinceResumeSeek: lastPendingResumeSeekAt
        ? Math.round(performance.now() - lastPendingResumeSeekAt)
        : null,
    }));

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

    const unbindDanmakuSliderDrag = bindDanmakuSliderDrag(player);
    player.on('destroy', unbindDanmakuSliderDrag);
    bindDanmakuSettingPersistence(player, {
      enabledRef: danmakuEnabledRef,
      onEnabledChange: onDanmakuEnabledChange,
      onEnable: onDanmakuEnable,
    });

    player.on('ready', () => {
      setError(null);
      if (player.playing) {
        void requestWakeLock();
      }
    });

    player.on('play', () => {
      const activeVideo = player.video as HTMLVideoElement | undefined;
      if (activeVideo) {
        // 运行时已释放时拉流会重新加载被放弃的旧地址，保持暂停等新地址接管
        if (pauseIfVodRuntimeReleased(activeVideo)) return;
        resumeHlsLoadingIfStopped(activeVideo);
      }
      void requestWakeLock();
      setIsPlaying(true);
    });

    player.on('video:playing', () => {
      ensureInitialPlaybackPosition();
      finishInitialLoading(true);
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('playing');
      if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
        retryPendingResumePosition();
      }
    });

    player.on('pause', () => {
      void releaseWakeLock();
      saveCurrentPlayProgress();
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('pause');
      setIsPlaying(false);
    });

    player.on('video:ended', () => {
      void releaseWakeLock();
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('ended');
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
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('timeupdate');
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
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('error');
      console.error('播放器错误:', error);
      const activeVideo = player.video as HTMLVideoElement | undefined;
      // 运行时已释放时出错的是被放弃的旧地址，Artplayer 重连会把它重新挂上：保持暂停，不上报也不切线路
      if (activeVideo && pauseIfVodRuntimeReleased(activeVideo)) {
        return;
      }
      if (isStalePlayerSession()) return;
      if (player.currentTime > 0) {
        return;
      }
      if (
        mediaKind !== 'native' ||
        navigator.onLine === false ||
        activeVideo?.error?.code === 1
      )
        return;
      if (activeVideo?.error?.code !== 2) {
        onPlaybackRecoveryExhausted?.('native-media-error');
        return;
      }
      reportNativeRouteStat(false);
      if (
        mediaKind === 'native' &&
        switchNativeToServerProxy(error.message || 'network-error')
      )
        return;
      onPlaybackRecoveryExhausted?.('native-network-error');
    });

    player.on('video:timeupdate', () => {
      const now = Date.now();
      if (now - lastSaveTimeRef.current > 5000) {
        saveCurrentPlayProgress();
      }
    });

    // 媒体键、画中画等直接暂停元素时不一定经过 Artplayer 的 pause 事件
    for (const event of ['pause', 'waiting', 'stalled', 'error'] as const) {
      player.on(`video:${event}`, () => {
        if (!isStalePlayerSession()) handlePlaybackStatsEvent?.(event);
      });
    }

    player.on('video:seeking', () => {
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('seeking');
      updateStableCurrentTime(player.currentTime || 0);
    });

    player.on('video:seeked', () => {
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('seeked');
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
    // 初始化被取代时静默退出
    if (isCancelled()) {
      return;
    }
    setError('播放器初始化失败');
  }
}
