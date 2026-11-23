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
  NEXT_EPISODE_COUNTDOWN_SECONDS,
  resolveNextEpisodeCountdown,
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
import { isNearPlaybackCompletion } from '@/features/play/lib/episodeProgress';
import { resolveActivePlayTime } from '@/features/play/lib/episodeResumePolicy';
import { prewarmLazyEpisodeUrl } from '@/features/play/lib/lazyEpisode';
import { scheduleNextEpisodePreload } from '@/features/play/lib/nextEpisodePreload';
import { getNextPlaybackEpisode } from '@/features/play/lib/playbackStartPolicy';
import { clearPlaybackStartState } from '@/features/play/lib/playbackStartState';
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
  type PlayerPrompt,
  createPlayerPrompt,
} from '@/features/play/lib/playerPrompt';
import {
  clearExplicitPlaybackSeek,
  recordExplicitPlaybackSeek,
} from '@/features/play/lib/playProgressRestore';
import {
  applyResumeTime,
  isProgrammaticResumeSeek,
  isWithinAutoResumeWindow,
  resolvePendingResumeTime,
  resolveResumeTimeTarget,
  shouldForcePlaybackStartFromHead,
} from '@/features/play/lib/resumePlayback';
import {
  createVodM3u8Loader,
  getVodRuntimeSourceUrl,
  isVodRuntimeWaitingForResource,
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
import { writePlaybackRate } from '@/lib/local-preferences';
import {
  bindPlayerHoverControls,
  bindPlayerMobileControls,
  createHlsLoaderClass,
  getManagedVideo,
  getPlayerModules,
  isPlayerFastForwarding,
  prefetchM3U8,
  restorePlayerPlaybackRate,
  runManagedVideoCleanup,
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

// 暂停、切后台、关页、换集都会立即保存，定时保存只兜底异常退出
const PERIODIC_PROGRESS_SAVE_INTERVAL_MS = 20_000;
const DOUBLE_TAP_SEEK_SECONDS = 10;
const RESUME_PROMPT_MIN_SECONDS = 10;
const RESUME_PROMPT_DURATION_MS = 6_000;

interface UseArtPlayerInitState {
  loadingSessionRef: MutableRefObject<PlayerLoadingSessionState>;
  autoAdvanceArmedRef: MutableRefObject<boolean>;
  autoAdvancedRef: MutableRefObject<boolean>;
  playerMediaKindRef: MutableRefObject<'hls' | 'native' | null>;
  sessionEpisodeIndexRef: MutableRefObject<number | null>;
  playbackRouteRef: MutableRefObject<SourcePlaybackRoute | null>;
  resumePromptHandledRef: MutableRefObject<boolean>;
  endPromptsRef: MutableRefObject<Pick<PlayerPrompt, 'hide'> | null>;
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
    onPlaybackUrlForbidden,
    onCurrentSourceVideoInfo,
    onLastEpisodeNearEnd,
    onLastEpisodeEnded,
  } = params;
  const {
    loadingSessionRef,
    autoAdvanceArmedRef,
    autoAdvancedRef,
    playerMediaKindRef,
    sessionEpisodeIndexRef,
    playbackRouteRef,
    resumePromptHandledRef,
    endPromptsRef,
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

    const isStartHeld = () =>
      !!params.startStateRef &&
      (params.startStateRef.current.parked ||
        params.startStateRef.current.pendingDuration !== null);

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
      clearExplicitPlaybackSeek(stableCurrentTimeRef);
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
      // 停靠起播时创建的播放器关闭了自动播放，复用时按本次起播状态恢复
      if (reusedPlayer.video) reusedPlayer.video.autoplay = !isStartHeld();
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
    clearExplicitPlaybackSeek(stableCurrentTimeRef);

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
      onPlaybackUrlForbidden,
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
        // 原生跨域 MP4 使用 no-cors 播放，避免上游拒绝 Origin；其 canvas 截图会被污染。
        screenshot: mediaKind === 'hls',
        moreVideoAttr: {
          crossOrigin: mediaKind === 'hls' ? 'anonymous' : null,
        },
        fastForward: false,
      }),
      ...(isStartHeld() ? { autoplay: false } : {}),
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
        stableCurrentTimeRef,
        clearTargetEpisodeProgressRef,
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
    // 点播恢复统一由受管运行时处理，移除 Artplayer 延迟重设旧 URL 的内建重连。
    player.off('video:error');
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
    bindPlayerMobileControls(player, {
      doubleTapSeekSeconds: DOUBLE_TAP_SEEK_SECONDS,
    });
    const resumePrompt = createPlayerPrompt(player, 'start');
    const finishedPrompt = createPlayerPrompt(player, 'end');
    const nextEpisodePrompt = createPlayerPrompt(player, 'end');
    const completionPrompt = createPlayerPrompt(player, 'end');
    const hideEndPrompts = () => {
      finishedPrompt.hide();
      nextEpisodePrompt.hide();
      completionPrompt.hide();
    };
    endPromptsRef.current = { hide: hideEndPrompts };
    // 用户在本集取消了连播倒计时：片末与片尾点都不再自动切集，片尾也不再被暂停
    let autoAdvanceCancelledUrl: string | null = null;
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

      const resumeTarget = resolveActivePlayTime({
        targetEpisodePending: clearTargetEpisodeProgressRef.current,
        playerCurrentTime: player.currentTime || 0,
        pendingResumeTime: resumeTimeRef.current,
        stableCurrentTime: stableCurrentTimeRef.current,
      });
      const sessionStarted = loadingSessionRef.current.playbackStartNotified;
      const userPaused = sessionStarted && player.video?.paused === true;
      // resumeTimeRef 只在首次起播时清空，已起播后只登记本会话落地一次的目标，否则之后每次 canplay / progress 都会跳回
      if (!sessionStarted) {
        resumeTimeRef.current = resumeTarget;
        resumeModeRef.current = 'forced';
      }
      loadingSessionRef.current.pendingInitialResumeTarget = resumeTarget;
      nativeUseServerProxy = nextServer;
      nativeAttempt.routeSwitched = true;
      nativeAttempt.triedRoutes.add(nextServer ? 'server' : 'browser');
      setRealtimeLoadSpeed('直连失败，切换代理...');
      if (!userPaused) {
        setIsVideoLoading(true);
        onSourceProxyFallbackStarted?.();
      }

      try {
        waitForDanmakuPlayerSwitch(player, player.switchUrl(fallbackUrl));
        player.once('video:loadedmetadata', () => {
          if (isStalePlayerSession()) return;
          applyResumeTime(player, resumeTarget);
        });
        const activeVideo = player.video as HTMLVideoElement | undefined;
        if (activeVideo) {
          const managedVideo = getManagedVideo(activeVideo);
          managedVideo.__icetvUsingServerProxy = nextServer;
          ensureVideoSource(activeVideo, fallbackUrl);
          if (userPaused) {
            activeVideo.pause();
          } else {
            void activeVideo.play().catch(() => {});
          }
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
      if (isStalePlayerSession() || isParked()) return false;
      if (autoAdvanceCancelledUrl === player.option.url) return false;
      const currentDetail = detailRef.current;
      const episodeIndex = currentEpisodeIndexRef.current;
      if (
        !currentDetail ||
        getNextPlaybackEpisode(currentDetail, episodeIndex) === null
      )
        return false;
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
      nextEpisodePrompt.hide();
      resumePrompt.hide();
      restorePlayerPlaybackRate(player, lastPlaybackRateRef.current);
      handleNextEpisode();
      return true;
    };

    const updateNextEpisodeCountdown = () => {
      const episodeCount = detailRef.current?.episodes?.length ?? 0;
      const eligible =
        !isParked() &&
        !!detailRef.current &&
        getNextPlaybackEpisode(
          detailRef.current,
          currentEpisodeIndexRef.current,
        ) !== null &&
        autoPlayNextEnabledRef.current &&
        autoAdvanceArmedRef.current &&
        !autoAdvancedRef.current &&
        autoAdvanceCancelledUrl !== player.option.url &&
        loadingSessionRef.current.pendingInitialResumeTarget === null &&
        currentEpisodeIndexRef.current < episodeCount - 1;
      const outroOffset = skipConfigRef.current.enable
        ? skipConfigRef.current.outro_time
        : 0;
      const remaining = eligible
        ? resolveNextEpisodeCountdown(
            player.currentTime || 0,
            player.duration || 0,
            outroOffset,
          )
        : null;
      if (remaining === null) {
        nextEpisodePrompt.hide();
        return;
      }
      const text = `下一集 · ${remaining} 秒后播放`;
      if (nextEpisodePrompt.visible) {
        nextEpisodePrompt.setText(text);
        return;
      }
      resumePrompt.hide();
      hideEndPrompts();
      nextEpisodePrompt.show(text, [
        {
          label: '立即播放',
          primary: true,
          onClick: () => {
            nextEpisodePrompt.hide();
            tryAutoAdvanceEpisode();
          },
        },
        {
          label: '取消',
          onClick: () => {
            autoAdvanceCancelledUrl = player.option.url;
            nextEpisodePrompt.hide();
          },
        },
      ]);
    };

    let resumePromptUrl: string | null = null;
    const showInitialResumePrompt = () => {
      resumePrompt.hide();
      if (isStalePlayerSession() || isParked()) return;
      const resumedAt = player.currentTime || 0;
      const duration = player.duration || 0;
      // 续播点已在片末时马上会连播下一集，不提示
      if (
        resumedAt < RESUME_PROMPT_MIN_SECONDS ||
        (duration > 0 && duration - resumedAt <= NEXT_EPISODE_COUNTDOWN_SECONDS)
      )
        return;
      resumePromptUrl = player.option.url;
      resumePrompt.show(
        `已从 ${formatTime(resumedAt)} 继续播放`,
        [
          {
            label: '从头播放',
            primary: true,
            onClick: () => {
              resumePrompt.hide();
              const { enable, intro_time } = skipConfigRef.current;
              player.currentTime = enable && intro_time > 0 ? intro_time : 0;
            },
          },
        ],
        RESUME_PROMPT_DURATION_MS,
      );
    };

    const isLastPlaybackEpisode = () => {
      const currentDetail = detailRef.current;
      const index = currentEpisodeIndexRef.current;
      return (
        !!currentDetail?.episodes[index] &&
        getNextPlaybackEpisode(currentDetail, index) === null
      );
    };
    const canOpenCompletion = () =>
      !isStalePlayerSession() &&
      isLastPlaybackEpisode() &&
      detailRef.current?.series_status !== 'ongoing';
    const canPromptCompletion = () =>
      !isStalePlayerSession() &&
      !isParked() &&
      loadingSessionRef.current.playbackStartNotified &&
      loadingSessionRef.current.pendingInitialResumeTarget === null &&
      !clearTargetEpisodeProgressRef.current &&
      canOpenCompletion() &&
      isNearPlaybackCompletion(
        player.currentTime || 0,
        player.duration || 0,
        skipConfigRef.current,
      );
    const updateCompletionPrompt = () => {
      if (!canPromptCompletion()) {
        completionPrompt.hide();
        return;
      }
      if (completionPrompt.visible || !onLastEpisodeNearEnd?.()) return;
      const { source, id } = detailRef.current!;
      const episodeIndex = currentEpisodeIndexRef.current;
      const url = player.option.url;
      resumePrompt.hide();
      hideEndPrompts();
      completionPrompt.show('本片即将看完', [
        {
          label: '观影小结',
          primary: true,
          onClick: () => {
            completionPrompt.hide();
            if (
              canPromptCompletion() &&
              detailRef.current?.source === source &&
              detailRef.current?.id === id &&
              currentEpisodeIndexRef.current === episodeIndex &&
              player.option.url === url
            )
              onLastEpisodeEnded?.(true);
          },
        },
        { label: '关闭', onClick: () => completionPrompt.hide() },
      ]);
    };
    const notifyIfLastEpisodeEnded = () => {
      hideEndPrompts();
      if (isParked() || !canOpenCompletion()) return;
      resumePrompt.hide();
      completionPrompt.show('全片已播完', [
        {
          label: '观影小结',
          primary: true,
          onClick: () => {
            if (completionPrompt.visible && canOpenCompletion())
              onLastEpisodeEnded?.(true);
          },
        },
        { label: '重看', onClick: replayEpisode },
      ]);
      onLastEpisodeEnded?.();
    };

    const handleEpisodeEnd = (reason: 'ended' | 'threshold' | 'outro') => {
      if (isStalePlayerSession() || isParked()) return false;
      if (tryAutoAdvanceEpisode()) return true;
      if (reason === 'outro') player.pause();
      if (reason !== 'threshold') {
        saveCurrentPlayProgress();
        notifyIfLastEpisodeEnded();
      }
      return false;
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

    const isParked = () => params.startStateRef?.current.parked === true;
    const replayEpisode = () => {
      if (isStalePlayerSession()) return;
      hideEndPrompts();
      if (params.startStateRef)
        clearPlaybackStartState(params.startStateRef.current);
      const { enable, intro_time } = skipConfigRef.current;
      const target = enable && intro_time > 0 ? intro_time : 0;
      resumeTimeRef.current = null;
      resumeModeRef.current = null;
      loadingSessionRef.current.pendingInitialResumeTarget = null;
      clearTargetEpisodeProgressRef.current = false;
      stableCurrentTimeRef.current = target;
      player.currentTime = target;
      recordExplicitPlaybackSeek(stableCurrentTimeRef, target);
      autoAdvanceArmedRef.current = true;
      void player.play();
    };
    const refreshFinishedPrompt = () => {
      if (!isParked()) {
        finishedPrompt.hide();
        return;
      }
      const currentDetail = detailRef.current;
      const hasNext =
        currentDetail &&
        getNextPlaybackEpisode(
          currentDetail,
          currentEpisodeIndexRef.current,
        ) !== null;
      hideEndPrompts();
      finishedPrompt.show('本集已播完', [
        { label: '重看', primary: true, onClick: replayEpisode },
        ...(hasNext ? [{ label: '下一集', onClick: handleNextEpisode }] : []),
        ...(canOpenCompletion()
          ? [
              {
                label: '观影小结',
                onClick: () => {
                  if (isParked() && canOpenCompletion())
                    onLastEpisodeEnded?.(true);
                },
              },
            ]
          : []),
      ]);
    };
    const holdFinishedEpisode = () => {
      if (!isParked()) return false;
      player.pause();
      completionPrompt.hide();
      nextEpisodePrompt.hide();
      resumePrompt.hide();
      autoAdvanceArmedRef.current = false;
      const target = resumeTimeRef.current;
      if (target !== null) applyResumeTime(player, target);
      if (
        shouldDismissLoadingFromReadyFrame(player.video) ||
        player.video?.ended
      ) {
        loadingSessionRef.current.pendingInitialResumeTarget = null;
        setIsVideoLoading(false);
        setRealtimeLoadSpeed('');
      }
      setIsPlaying(false);
      refreshFinishedPrompt();
      return true;
    };
    if (params.startStateRef) {
      params.startStateRef.current.refreshPrompt = refreshFinishedPrompt;
      params.startStateRef.current.showResumePrompt = showInitialResumePrompt;
      player.on('destroy', () => {
        if (
          params.startStateRef?.current.refreshPrompt === refreshFinishedPrompt
        )
          params.startStateRef.current.refreshPrompt = undefined;
        if (
          params.startStateRef?.current.showResumePrompt ===
          showInitialResumePrompt
        )
          params.startStateRef.current.showResumePrompt = undefined;
      });
    }

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

    let initialResumeApplied = false;
    const finishInitialLoading = (playing = false) => {
      if (isStalePlayerSession() || holdFinishedEpisode()) {
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

      // 进入页面后的首次起播与切集续播时提示；去广告重建、换源各自有提示或无需提示。
      // 复用播放器换集时续播点在 loadedmetadata 落地，不经过 initialResumeApplied，按起播位置判断
      const showResumePrompt =
        playbackRequestModeRef.current === 'episode' ||
        (!resumePromptHandledRef.current &&
          initialResumeApplied &&
          playbackRequestModeRef.current === 'initial');
      resumePromptHandledRef.current = true;
      initialResumeApplied = false;
      resumeTimeRef.current = null;
      resumeModeRef.current = null;
      autoAdvanceArmedRef.current = true;
      notifyPlayerPlaybackStarted();
      if (showResumePrompt) showInitialResumePrompt();
    };

    let initialPlaybackRequestInFlight = false;
    // hls 仍在加载时再 startLoad 会中止在途分片并从头重下，只在加载被停掉时补拉；资源限流退避由运行时按时补拉
    const resumeHlsLoadingIfStopped = (video: HTMLVideoElement) => {
      const hls = getManagedVideo(video).hls;
      if (hls && !hls.loadingEnabled && !isVodRuntimeWaitingForResource(video))
        hls.startLoad();
    };
    const requestInitialPlayback = (
      video: HTMLVideoElement | null | undefined,
    ) => {
      if (
        !video ||
        initialPlaybackRequestInFlight ||
        isParked() ||
        params.startStateRef?.current.pendingDuration
      ) {
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

    const resolvePendingStart = () => {
      const changed = params.resolveStartDuration?.(player.duration) ?? false;
      return holdFinishedEpisode() || changed;
    };

    const completePendingResumeIfReady = () => {
      if (resolvePendingStart()) return false;
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
      if (resolvePendingStart()) return false;
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
      if (isStalePlayerSession() || resolvePendingStart()) {
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
        // 落点可能要等后续重试 seek 才到达，起播时再按实际位置决定是否提示
        initialResumeApplied = pendingResumeTime > 0;
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

    // 已起播会话里线路恢复或资源等待期间用户暂停，不会再有 playing 收起加载层；落点已到且画面就绪即结束等待
    const finishRecoveryIfPausedReady = () => {
      if (isStalePlayerSession()) return;
      const activeVideo = player.video as HTMLVideoElement | null;
      if (
        loadingSessionRef.current.playbackStartNotified &&
        loadingSessionRef.current.pendingInitialResumeTarget === null &&
        activeVideo?.paused &&
        shouldDismissLoadingFromReadyFrame(activeVideo)
      ) {
        finishInitialLoading(true);
      }
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
      // 起播后播放与暂停由用户决定，就绪事件不再代为播放
      const mayRequestPlayback =
        hasReadyFrame && !loadingSessionRef.current.playbackStartNotified;
      if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
        if (!completePendingResumeIfReady()) {
          retryPendingResumePosition();
        }
        if (!isPlayingReady && mayRequestPlayback) {
          requestInitialPlayback(activeVideo);
        }
        finishRecoveryIfPausedReady();
        return;
      }

      if (mayRequestPlayback) {
        requestInitialPlayback(activeVideo);
      }
      finishRecoveryIfPausedReady();
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
      if (isParked()) {
        replayEpisode();
        return;
      }
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
      if (resolvePendingStart()) return;
      ensureInitialPlaybackPosition();
      finishInitialLoading(true);
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('playing');
      if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
        retryPendingResumePosition();
      }
    });

    player.on('pause', () => {
      finishRecoveryIfPausedReady();
      void releaseWakeLock();
      saveCurrentPlayProgress();
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('pause');
      setIsPlaying(false);
    });

    player.on('video:ended', () => {
      if (isStalePlayerSession()) return;
      if (resolvePendingStart()) return;
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
      handleEpisodeEnd('ended');
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
      writePlaybackRate(lastPlaybackRateRef.current);
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
          !isPlayerFastForwarding(player)
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

    let introSettledUrl: string | null = null;
    let outroSettledUrl: string | null = null;
    player.on('video:timeupdate', () => {
      if (isStalePlayerSession() || resolvePendingStart()) {
        completionPrompt.hide();
        return;
      }
      handlePlaybackStatsEvent?.('timeupdate');
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
        if (handleEpisodeEnd('threshold')) {
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

      if (resumePrompt.visible && resumePromptUrl !== player.option.url)
        resumePrompt.hide();
      updateNextEpisodeCountdown();
      updateCompletionPrompt();

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

      // 每集只自动跳一次片头：跳过后或本集起播后已越过片头，用户拖回片头重看不再被弹走。
      // 换集初期播放器上可能还是上一集的时间，起播确认前不据此判定已越过。
      const introTime = skipConfigRef.current.intro_time;
      const episodeUrl = player.option.url;
      if (introTime > 0 && introSettledUrl !== episodeUrl) {
        if (skipCurrentTime < introTime) {
          player.currentTime = introTime;
          player.notice.show = `已跳过片头 (${formatTime(introTime)})`;
          introSettledUrl = episodeUrl;
        } else if (
          loadingSessionRef.current.playbackStartNotified &&
          !clearTargetEpisodeProgressRef.current
        ) {
          introSettledUrl = episodeUrl;
        }
      }

      // 片尾每集只处理一次：未连播时暂停后用户继续播放，不再反复被暂停
      if (
        skipConfigRef.current.outro_time < 0 &&
        skipDuration > 0 &&
        outroSettledUrl !== episodeUrl &&
        autoAdvanceCancelledUrl !== episodeUrl &&
        skipCurrentTime > player.duration + skipConfigRef.current.outro_time
      ) {
        outroSettledUrl = episodeUrl;
        handleEpisodeEnd('outro');
        player.notice.show = `已跳过片尾 (${formatTime(skipConfigRef.current.outro_time)})`;
      }
    });

    let nativeOfflineErrorPending = false;
    let nativeMetadataLoaded = false;
    player.on('video:loadedmetadata', () => {
      nativeMetadataLoaded = true;
    });
    const failNativePlayback = (reason: string) => {
      if (onPlaybackRecoveryExhausted?.(reason)) return;
      runManagedVideoCleanup(player.video as HTMLVideoElement);
      player.pause();
      setIsVideoLoading(false);
      setRealtimeLoadSpeed('');
      setError('当前源加载失败');
    };
    const handlePlayerError = (error: Error) => {
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('error');
      console.error('播放器错误:', error);
      const activeVideo = player.video as HTMLVideoElement | undefined;
      // 运行时已释放时出错的是被放弃的旧地址，Artplayer 重连会把它重新挂上：保持暂停，不上报也不切线路
      if (activeVideo && pauseIfVodRuntimeReleased(activeVideo)) {
        return;
      }
      if (isStalePlayerSession()) return;
      if (mediaKind !== 'native' || activeVideo?.error?.code === 1) return;
      if (navigator.onLine === false) {
        nativeOfflineErrorPending = true;
        return;
      }
      nativeOfflineErrorPending = false;
      // Chrome 在元数据前的跨域/网络失败也可能报 code 4；只给 auto 一次换路机会。
      const startupSourceError =
        playbackRoute.allowAutoFallback &&
        activeVideo?.error?.code === 4 &&
        !nativeMetadataLoaded &&
        !loadingSessionRef.current.playbackStartNotified;
      if (activeVideo?.error?.code !== 2 && !startupSourceError) {
        failNativePlayback('native-media-error');
        return;
      }
      reportNativeRouteStat(false);
      if (
        mediaKind === 'native' &&
        switchNativeToServerProxy(error?.message || 'network-error')
      )
        return;
      failNativePlayback('native-network-error');
    };
    const onNativeOnline = () => {
      if (
        nativeOfflineErrorPending &&
        navigator.onLine !== false &&
        !isStalePlayerSession()
      ) {
        handlePlayerError(new Error('network-restored'));
      }
    };
    if (mediaKind === 'native')
      window.addEventListener('online', onNativeOnline);
    const onRuntimeReleased = () => {
      hideEndPrompts();
      resumePrompt.hide();
      autoAdvanceArmedRef.current = false;
      nativeOfflineErrorPending = false;
      window.removeEventListener('online', onNativeOnline);
    };
    getManagedVideo(player.video as HTMLVideoElement).__icetvOnRuntimeReleased =
      onRuntimeReleased;
    player.on('destroy', onRuntimeReleased);
    player.on('error', handlePlayerError);
    // 内建重连原本会转发 video:error；移除后由项目直接接管原生媒体错误。
    player.on('video:error', handlePlayerError);

    player.on('video:timeupdate', () => {
      const now = Date.now();
      if (now - lastSaveTimeRef.current > PERIODIC_PROGRESS_SAVE_INTERVAL_MS) {
        saveCurrentPlayProgress();
      }
    });

    // 媒体键、画中画等直接暂停元素时不一定经过 Artplayer 的 pause 事件
    for (const event of ['pause', 'waiting', 'stalled'] as const) {
      player.on(`video:${event}`, () => {
        if (!isStalePlayerSession()) handlePlaybackStatsEvent?.(event);
      });
    }

    const updateSeekProgress = (completed: boolean) => {
      if (isStalePlayerSession()) return;
      const programmatic = isProgrammaticResumeSeek(player, completed);
      if (
        isParked() &&
        !programmatic &&
        Math.abs((player.currentTime || 0) - (resumeTimeRef.current ?? 0)) > 1.5
      ) {
        clearPlaybackStartState(params.startStateRef!.current);
        resumeTimeRef.current = null;
        resumeModeRef.current = null;
        loadingSessionRef.current.pendingInitialResumeTarget = null;
        clearTargetEpisodeProgressRef.current = false;
        autoAdvanceArmedRef.current = true;
        recordExplicitPlaybackSeek(
          stableCurrentTimeRef,
          player.currentTime || 0,
        );
      }
      if (
        !programmatic &&
        loadingSessionRef.current.playbackStartNotified &&
        loadingSessionRef.current.pendingInitialResumeTarget === null &&
        !clearTargetEpisodeProgressRef.current
      ) {
        recordExplicitPlaybackSeek(
          stableCurrentTimeRef,
          player.currentTime || 0,
        );
      } else {
        updateStableCurrentTime(player.currentTime || 0);
      }
    };
    player.on('video:seeking', () => {
      completionPrompt.hide();
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('seeking');
      updateSeekProgress(false);
    });

    player.on('video:seeked', () => {
      if (!isStalePlayerSession()) handlePlaybackStatsEvent?.('seeked');
      updateSeekProgress(true);
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
