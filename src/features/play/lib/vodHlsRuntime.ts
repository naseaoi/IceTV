import type Artplayer from 'artplayer';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type {
  CurrentSourceVideoInfo,
  CurrentSourceVideoInfoContext,
} from '@/features/play/hooks/artPlayerTypes';
import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';
import { resolveSourceSwitchCurrentPlayTime } from '@/features/play/lib/episodeResumePolicy';
import { FragmentMemoryCacheLoader } from '@/features/play/lib/fragmentMemoryCache';
import {
  PLAYBACK_STALL_CONFIRMATION_DELAY_MS,
  resolvePlaybackStallDecision,
} from '@/features/play/lib/playbackStallRecovery';
import {
  type PlayerLoadingSessionState,
  beginVodStartupProgress,
  clearVodStartupProgress,
  registerStartupStateDescriber,
} from '@/features/play/lib/playerLoading';
import {
  type ResumeMode,
  resolvePendingResumeTime,
} from '@/features/play/lib/resumePlayback';
import {
  BROWSER_ROUTE_FAILURE_THRESHOLD,
  buildVodFragLoadPolicy,
  ConsecutiveRouteFailureTracker,
  resolveAutoRouteFailureWindowMs,
  resolveVodFragmentTimeoutMs,
  SERVER_ROUTE_FAILURE_THRESHOLD,
} from '@/features/play/lib/vodAutoRoutePolicy';
import { createVodBufferBudgetController } from '@/features/play/lib/vodBufferBudgetController';
import {
  createVodFragmentCacheRecoveryLoader,
  shouldRecoverVodFragmentHttpCache,
} from '@/features/play/lib/vodFragmentCacheRecovery';
import { createVodHlsQualityController } from '@/features/play/lib/vodHlsQualityController';
import {
  type VodPlaybackIntent,
  createVodPlaybackIntent,
  getVodSourceAttempt,
  isVodRouteNetworkError,
} from '@/features/play/lib/vodPlaybackIntent';
import { buildVodProxyUrl } from '@/features/play/lib/vodProxyUrl';
import { createVodSegmentPrebufferController } from '@/features/play/lib/vodSegmentPrebuffer';
import {
  getVodHlsBufferOverrides,
  getVodHlsLoadingOverrides,
  resolveVodSourceFragmentTimeoutMs,
} from '@/features/play/lib/vodSourcePlaybackPolicy';
import { logHlsError } from '@/lib/hls-error-log';
import {
  assignManagedVideoCleanup,
  destroyManagedHls,
  getManagedVideo,
  isManagedVideoExpectedAbort,
  markManagedVideoExpectedAbort,
  runManagedVideoCleanup,
} from '@/lib/player-runtime';
import {
  createHlsConfig,
  createHlsFatalRecoveryController,
  ensureVideoSource,
  formatBytesPerSecond,
} from '@/lib/player-utils';
import {
  type SourcePlaybackRoute,
  clearSourceProxyOverride,
  getSourcePlaybackRoute,
  rememberSourceServerProxy,
} from '@/lib/proxy-modes';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { reportSourceRouteStat } from '@/lib/source-route-stats.client';
import type { SearchResult } from '@/lib/types';

type HlsLoaderConstructor = new (config: unknown) => {
  load: (...args: unknown[]) => void;
};

type CreateVodM3u8LoaderOptions = {
  Hls: any;
  adBlockingHlsLoader: HlsLoaderConstructor;
  artPlayerRef: MutableRefObject<Artplayer | null>;
  blockAdEnabledRef: MutableRefObject<boolean>;
  detailRef: MutableRefObject<SearchResult | null>;
  playbackInfoContext: CurrentSourceVideoInfoContext;
  playbackIntentRef?: MutableRefObject<VodPlaybackIntent>;
  playbackRouteRef?: MutableRefObject<SourcePlaybackRoute | null>;
  playbackRequestModeRef: MutableRefObject<PlaybackRequestMode>;
  resumeTimeRef: MutableRefObject<number | null>;
  resumeModeRef: MutableRefObject<ResumeMode>;
  allowAutoResumeRef: MutableRefObject<boolean>;
  stableCurrentTimeRef: MutableRefObject<number>;
  loadingSessionRef: MutableRefObject<PlayerLoadingSessionState>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setRealtimeLoadSpeed: Dispatch<SetStateAction<string>>;
  onSourceProxyFallbackStarted?: () => void;
  // 返回 true 表示外层已接手（如自动换源），不再展示当前源失败
  onPlaybackRecoveryExhausted?: (reason: string) => boolean;
  onCurrentSourceVideoInfo?: (
    info: CurrentSourceVideoInfo,
    context: CurrentSourceVideoInfoContext,
  ) => void;
};

function resolveVideoQuality(videoWidth: number): string {
  if (videoWidth >= 3840) return '4K';
  if (videoWidth >= 2560) return '2K';
  if (videoWidth >= 1920) return '1080p';
  if (videoWidth >= 1280) return '720p';
  if (videoWidth >= 854) return '480p';
  return 'SD';
}

// hls.js 流控制器处于这些状态时分片或清单的请求、重试、解析仍在进行，超时与重试由其加载策略负责；此时 startLoad 会中止在途分片并从头重下
const HLS_LOAD_IN_PROGRESS_STATES: ReadonlySet<string | undefined> = new Set([
  'KEY_LOADING',
  'FRAG_LOADING',
  'FRAG_LOADING_WAITING_RETRY',
  'PARSING',
  'PARSED',
  'WAITING_LEVEL',
]);

// 运行时释放时同步移除；页面层据此确认挂在 video 上的运行时仍属于当前播放地址
const vodRuntimeSourceUrls = new WeakMap<HTMLVideoElement, string>();

export function getVodRuntimeSourceUrl(video: HTMLVideoElement): string | null {
  return vodRuntimeSourceUrls.get(video) ?? null;
}

// 原生播放没有 hls 运行时，同样登记本次加载的地址并挂上释放入口，换源和逐集解析停旧集时随之释放
export function registerVodNativeRuntime(
  video: HTMLVideoElement,
  url: string,
  intent?: VodPlaybackIntent,
) {
  runManagedVideoCleanup(video);
  getManagedVideo(video).__icetvSwitchToServerProxy = null;
  vodRuntimeSourceUrls.set(video, url);
  const attempt = intent?.activeSource;
  const beginProgress = () => {
    const next = beginVodStartupProgress(video, '');
    if (attempt) {
      attempt.startedAt ??= next.startedAt;
      next.startedAt = attempt.startedAt;
    }
    return next;
  };
  let progress = beginProgress();
  let bufferedEnd = 0;
  const onLoadStart = () => {
    bufferedEnd = 0;
    progress = beginProgress();
  };
  const onProgress = () => {
    const end = video.buffered.length
      ? video.buffered.end(video.buffered.length - 1)
      : 0;
    if (end > bufferedEnd) {
      bufferedEnd = end;
      progress.lastProgressAt = performance.now();
    }
  };
  const onLoadedMetadata = () => {
    progress.lastProgressAt = performance.now();
  };
  const onPlaying = () => {
    if (attempt) attempt.startedAt = null;
  };
  video.addEventListener('playing', onPlaying);
  video.addEventListener('loadstart', onLoadStart);
  video.addEventListener('progress', onProgress);
  video.addEventListener('loadedmetadata', onLoadedMetadata);
  assignManagedVideoCleanup(video, () => {
    getManagedVideo(video).__icetvSwitchToServerProxy = null;
    vodRuntimeSourceUrls.delete(video);
    clearVodStartupProgress(video);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('loadstart', onLoadStart);
    video.removeEventListener('progress', onProgress);
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
  });
}

// 已释放时视频上仍是被放弃的旧地址：保持暂停，调用方不再拉流、上报或切换线路
export function pauseIfVodRuntimeReleased(video: HTMLVideoElement): boolean {
  if (vodRuntimeSourceUrls.has(video)) return false;
  video.pause();
  return true;
}

export function createVodM3u8Loader({
  Hls,
  adBlockingHlsLoader,
  artPlayerRef,
  blockAdEnabledRef,
  detailRef,
  playbackInfoContext,
  playbackRouteRef,
  playbackIntentRef,
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
  onPlaybackRecoveryExhausted,
  onCurrentSourceVideoInfo,
}: CreateVodM3u8LoaderOptions) {
  return function loadVodM3u8(video: HTMLVideoElement, url: string) {
    if (!Hls) {
      console.error('HLS.js 未加载');
      return;
    }

    const intent = playbackIntentRef?.current ?? createVodPlaybackIntent();
    const managedVideo = getManagedVideo(video);

    runManagedVideoCleanup(managedVideo);

    const sourceKey = detailRef.current?.source || '';
    const attempt = getVodSourceAttempt(
      intent,
      sourceKey,
      detailRef.current?.id || '',
    );
    const fragmentTimeoutMs = resolveVodSourceFragmentTimeoutMs(
      sourceKey,
      resolveVodFragmentTimeoutMs(
        getRuntimeConfig()?.VOD_FRAGMENT_TIMEOUT_SECONDS,
      ),
    );
    const fragLoadPolicy = buildVodFragLoadPolicy(fragmentTimeoutMs);
    const sharedHlsConfig = createHlsConfig({
      preserveManualLevelOnError: true,
    });
    const sourceBufferOverrides = getVodHlsBufferOverrides(sourceKey);
    const sourceLoadingOverrides = getVodHlsLoadingOverrides(sourceKey);
    const hlsConfig = {
      ...sharedHlsConfig,
      ...sourceBufferOverrides,
    };
    const useClientAdFilter = blockAdEnabledRef.current;
    const fragmentHttpCacheRecovery =
      shouldRecoverVodFragmentHttpCache(sourceKey);
    const baseLoader = useClientAdFilter
      ? adBlockingHlsLoader
      : (Hls.DefaultConfig.loader as HlsLoaderConstructor);
    const sourceLoader = createVodFragmentCacheRecoveryLoader(
      baseLoader,
      sourceKey,
    );
    const existingHls = managedVideo.hls;
    const canReuseHls =
      !!existingHls &&
      managedVideo.__icetvClientAdFilter === useClientAdFilter &&
      managedVideo.__icetvFragmentHttpCacheRecovery ===
        fragmentHttpCacheRecovery;

    let hls: any;
    if (canReuseHls) {
      hls = existingHls;
      hls.config.maxBufferLength = hlsConfig.maxBufferLength;
      hls.config.maxMaxBufferLength = hlsConfig.maxMaxBufferLength;
      hls.config.maxBufferSize = hlsConfig.maxBufferSize;
      hls.config.loader = sourceLoader;
      hls.config.manifestLoadingTimeOut =
        sourceLoadingOverrides.manifestLoadingTimeOut ?? 10000;
      hls.config.levelLoadingTimeOut =
        sourceLoadingOverrides.levelLoadingTimeOut ?? 10000;
      hls.config.fragLoadPolicy = fragLoadPolicy;
      const oldHandlers = managedVideo.__icetvHlsHandlers;
      if (oldHandlers) {
        hls.off(Hls.Events.ERROR, oldHandlers.onError);
        hls.off(Hls.Events.FRAG_LOADED, oldHandlers.onFragLoaded);
        if (oldHandlers.onFragLoading) {
          hls.off(Hls.Events.FRAG_LOADING, oldHandlers.onFragLoading);
        }
        if (oldHandlers.onFragBuffered) {
          hls.off(Hls.Events.FRAG_BUFFERED, oldHandlers.onFragBuffered);
        }
        if (oldHandlers.onLevelLoaded) {
          hls.off(Hls.Events.LEVEL_LOADED, oldHandlers.onLevelLoaded);
        }
        if (oldHandlers.onManifestParsed) {
          hls.off(Hls.Events.MANIFEST_PARSED, oldHandlers.onManifestParsed);
        }
      }
    } else {
      destroyManagedHls(managedVideo);
      hls = new Hls({
        ...hlsConfig,
        manifestLoadingTimeOut:
          sourceLoadingOverrides.manifestLoadingTimeOut ?? 10000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut:
          sourceLoadingOverrides.levelLoadingTimeOut ?? 10000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        fragLoadPolicy,
        loader: sourceLoader as typeof Hls.DefaultConfig.loader,
        // 该类在实例化时才包裹 config.loader，复用实例改写 loader 后仍生效；下一集预载按引用识别它，不要另行包裹
        fLoader: FragmentMemoryCacheLoader,
      });
    }
    managedVideo.__icetvClientAdFilter = useClientAdFilter;
    managedVideo.__icetvFragmentHttpCacheRecovery = fragmentHttpCacheRecovery;

    const beginMediaLoad = () => {
      const resumeTarget =
        loadingSessionRef.current.pendingInitialResumeTarget ??
        resolvePendingResumeTime({
          resumeTime: resumeTimeRef.current,
          resumeMode: resumeModeRef.current,
          allowAutoResume: allowAutoResumeRef.current,
        });
      // 每次 loadSource（含实例复用和线路回落）都显式设置，避免带入上一集的位置。
      hls.config.startPosition = resumeTarget ?? 0;
      const observedBytes = new WeakMap<object, number>();
      const progress = beginVodStartupProgress(video, sourceKey, () => {
        if (videoRuntimeCleaned || managedVideo.hls !== hls) return;
        for (const entry of Object.values<{
          frag?: { stats?: { loaded?: number } };
          part?: { stats?: { loaded?: number } };
        }>(hls.inFlightFragments ?? {})) {
          const stats = entry?.part?.stats ?? entry?.frag?.stats;
          if (!stats) continue;
          const loaded = stats.loaded ?? 0;
          if (loaded > (observedBytes.get(stats) ?? 0)) {
            observedBytes.set(stats, loaded);
            progress.lastProgressAt = performance.now();
          }
        }
      });
      attempt.startedAt ??= progress.startedAt;
      progress.startedAt = attempt.startedAt;
      return progress;
    };
    let startupProgress: ReturnType<typeof beginMediaLoad> | null = null;
    const markStartupProgress = () => {
      if (startupProgress) startupProgress.lastProgressAt = performance.now();
    };

    const playbackRoute =
      playbackRouteRef?.current ?? getSourcePlaybackRoute(sourceKey, url);
    const buildTargetUrl = (rawUrl: string, useServerProxy: boolean) =>
      buildVodProxyUrl({
        rawUrl,
        useServerProxy,
        directManifest: !useServerProxy,
        sourceKey,
        playbackRequestMode: playbackRequestModeRef.current || 'initial',
      });

    const allowAutoFallback = playbackRoute.allowAutoFallback;
    attempt.allowAutoFallback = allowAutoFallback;
    const previousRoute = [...attempt.triedRoutes].at(-1);
    let currentUseServerProxy = previousRoute
      ? previousRoute === 'server'
      : playbackRoute.useServerProxy;
    let targetUrl = buildTargetUrl(url, currentUseServerProxy);
    managedVideo.__icetvUsingServerProxy = currentUseServerProxy;
    const segmentPrebufferController = createVodSegmentPrebufferController({
      getCurrentTime: () => video.currentTime || 0,
      isServerProxy: () => currentUseServerProxy,
      sourceKey,
    });
    const failureWindowMs = resolveAutoRouteFailureWindowMs(fragmentTimeoutMs);
    const browserFailureTracker = new ConsecutiveRouteFailureTracker(
      BROWSER_ROUTE_FAILURE_THRESHOLD,
      failureWindowMs,
    );
    const serverFailureTracker = new ConsecutiveRouteFailureTracker(
      SERVER_ROUTE_FAILURE_THRESHOLD,
      failureWindowMs,
    );
    const recoveryController = createHlsFatalRecoveryController();
    let videoRuntimeCleaned = false;
    const routeKey = (server: boolean) => (server ? 'server' : 'browser');
    attempt.triedRoutes.add(routeKey(currentUseServerProxy));
    let fallbackAwaitingProgress = attempt.routeSwitched;
    const routeStatReported = {
      browser: { success: false, failure: false },
      server: { success: false, failure: false },
    };
    const reportRouteStat = (success: boolean) => {
      if (!sourceKey) return;
      const mode = currentUseServerProxy ? 'server' : 'browser';
      const state = routeStatReported[mode];
      if (success) {
        if (state.success) return;
        state.success = true;
      } else {
        if (state.failure) return;
        state.failure = true;
      }
      reportSourceRouteStat(sourceKey, mode, success);
    };

    setRealtimeLoadSpeed('测速中...');

    let firstFragSpeed = '';
    let firstFragPing = 0;
    let videoInfoReported = false;
    let fragLoadStart = performance.now();

    let speedFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const resetSpeedFallbackTimer = () => {
      if (speedFallbackTimer) {
        clearTimeout(speedFallbackTimer);
      }
      speedFallbackTimer = setTimeout(() => {
        setRealtimeLoadSpeed((prev) =>
          prev === '测速中...' ? '0 KB/s' : prev,
        );
      }, 5000);
    };
    resetSpeedFallbackTimer();

    let lastStallRecoveryAt = 0;
    let stallConfirmationTimer: ReturnType<typeof setTimeout> | null = null;
    const qualityController = createVodHlsQualityController({
      sourceKey,
      hls,
      video,
      artPlayerRef,
      setRealtimeLoadSpeed,
    });
    const bufferBudgetController = createVodBufferBudgetController({
      hls,
      video,
      bufferFullErrorDetail: Hls.ErrorDetails?.BUFFER_FULL_ERROR,
    });
    const failCurrentSource = (reason: string) => {
      if (onPlaybackRecoveryExhausted?.(reason)) {
        return;
      }
      // 自动换源接手时由换源流程释放；否则先取消恢复，再停止加载，保留实例供手动重试。
      runManagedVideoCleanup(video);
      if (typeof hls.stopLoad === 'function') {
        hls.stopLoad();
      }
      video.pause();
      setIsVideoLoading(false);
      setRealtimeLoadSpeed('');
      setError('当前源加载失败');
    };
    const failureKey =
      playbackInfoContext.source && playbackInfoContext.id
        ? `${playbackInfoContext.source}-${playbackInfoContext.id}`
        : '';

    const preservePlaybackPositionBeforeReload = () => {
      const resumeTime = resolveSourceSwitchCurrentPlayTime({
        playerCurrentTime: video.currentTime || 0,
        pendingResumeTime: resumeTimeRef.current,
        stableCurrentTime: stableCurrentTimeRef.current,
      });
      if (resumeTime <= 1) {
        return;
      }
      resumeTimeRef.current = resumeTime;
      resumeModeRef.current = 'forced';
      loadingSessionRef.current.pendingInitialResumeTarget = null;
    };

    const switchRoute = (_reason: string) => {
      const nextServer = !currentUseServerProxy;
      if (
        videoRuntimeCleaned ||
        (playbackIntentRef && playbackIntentRef.current !== intent) ||
        managedVideo.hls !== hls ||
        !allowAutoFallback ||
        !sourceKey ||
        navigator.onLine === false ||
        attempt.routeSwitched ||
        attempt.triedRoutes.has(routeKey(nextServer))
      )
        return false;
      attempt.routeSwitched = true;
      attempt.triedRoutes.add(routeKey(nextServer));
      reportRouteStat(false);
      currentUseServerProxy = nextServer;
      fallbackAwaitingProgress = true;
      targetUrl = buildTargetUrl(url, nextServer);
      managedVideo.__icetvUsingServerProxy = nextServer;
      segmentPrebufferController.dispose();
      recoveryController.cancelPendingRetry();
      firstFragSpeed = '';
      firstFragPing = 0;
      videoInfoReported = false;
      fragLoadStart = performance.now();
      setRealtimeLoadSpeed(
        nextServer ? '直连失败，切换代理...' : '代理失败，切换直连...',
      );
      resetSpeedFallbackTimer();
      preservePlaybackPositionBeforeReload();
      setIsVideoLoading(true);
      onSourceProxyFallbackStarted?.();
      markManagedVideoExpectedAbort(video);
      hls.stopLoad?.();
      startupProgress = beginMediaLoad();
      hls.loadSource(targetUrl);
      ensureVideoSource(video, targetUrl);
      return true;
    };

    // 清单从未加载成功时 hls 没有 level，startLoad 不会重新请求清单，只能按当前线路重新 loadSource
    const resumeLoading = () => {
      if (hls.levels?.length) {
        hls.startLoad();
        return;
      }
      hls.loadSource(targetUrl);
    };

    managedVideo.__icetvSwitchToServerProxy = switchRoute;
    registerStartupStateDescriber(video, 'route', () => ({
      allowAutoFallback,
      currentUseServerProxy,
      triedRoutes: [...attempt.triedRoutes],
      routeSwitched: attempt.routeSwitched,
      fragmentTimeoutMs,
    }));
    vodRuntimeSourceUrls.set(video, url);

    const getBufferedRanges = () => {
      const ranges: Array<[number, number]> = [];
      for (let i = 0; i < video.buffered.length; i += 1) {
        ranges.push([video.buffered.start(i), video.buffered.end(i)]);
      }
      return ranges;
    };

    const getBufferedEnd = (time: number) => {
      const range = getBufferedRanges().find(
        ([start, end]) => time >= start && time < end,
      );
      return range ? range[1] : time;
    };

    const isHlsLoadInProgress = () =>
      Object.values<{ state?: string } | null | undefined>(
        hls.inFlightFragments ?? {},
      ).some((inFlight) => HLS_LOAD_IN_PROGRESS_STATES.has(inFlight?.state));

    const clearStallConfirmation = () => {
      if (!stallConfirmationTimer) return;
      clearTimeout(stallConfirmationTimer);
      stallConfirmationTimer = null;
    };

    const tryRecoverPlaybackStall = (reason: 'waiting' | 'stalled') => {
      if (video.paused || video.ended || stallConfirmationTimer) {
        return;
      }

      const observedTime = video.currentTime || 0;
      const observedBufferedEnd = getBufferedEnd(observedTime);
      stallConfirmationTimer = setTimeout(() => {
        stallConfirmationTimer = null;
        if (video.paused || video.ended) return;

        const currentTime = video.currentTime || 0;
        if (currentTime - observedTime >= 0.05) return;

        const ranges = getBufferedRanges();
        const decision = resolvePlaybackStallDecision(currentTime, ranges);
        if (decision.action === 'none') return;

        const now = Date.now();
        if (now - lastStallRecoveryAt < 1500) return;
        lastStallRecoveryAt = now;

        console.warn('检测到点播播放卡顿', {
          reason,
          currentTime: Number(currentTime.toFixed(2)),
          readyState: video.readyState,
          networkState: video.networkState,
          bufferedAhead: Number(decision.bufferedAhead.toFixed(2)),
          gapToNext:
            decision.gapToNext === null
              ? null
              : Number(decision.gapToNext.toFixed(2)),
          bufferedRanges: ranges.map(([start, end]) => [
            Number(start.toFixed(2)),
            Number(end.toFixed(2)),
          ]),
        });

        if (decision.action === 'seek' && decision.targetTime !== null) {
          video.currentTime = decision.targetTime;
          return;
        }

        // 加载已停止时由停止方负责重新拉流：致命错误走恢复控制器，失败源不再拉流
        if (!hls.loadingEnabled) return;
        setRealtimeLoadSpeed('源站响应较慢，正在继续加载');
        if (
          isHlsLoadInProgress() ||
          getBufferedEnd(currentTime) > observedBufferedEnd
        ) {
          return;
        }
        hls.startLoad();
      }, PLAYBACK_STALL_CONFIRMATION_DELAY_MS);
    };

    const onWaiting = () => {
      tryRecoverPlaybackStall('waiting');
    };
    const onStalled = () => {
      tryRecoverPlaybackStall('stalled');
    };
    const onPlaying = () => {
      if (
        videoRuntimeCleaned ||
        (playbackIntentRef && playbackIntentRef.current !== intent)
      )
        return;
      // 起播完成关闭本轮预算，后续故障开启恢复预算；线路与换源尝试仍属于同一意图。
      attempt.startedAt = null;
      clearStallConfirmation();
    };
    const onTimeUpdate = () => {
      recoveryController.handlePlaybackProgress(video.currentTime);
    };
    const tryReportVideoInfo = () => {
      if (videoInfoReported || !firstFragSpeed) return;
      const w = video.videoWidth;
      if (!w || w <= 0) return;
      videoInfoReported = true;
      onCurrentSourceVideoInfo?.(
        {
          quality: resolveVideoQuality(w),
          loadSpeed: firstFragSpeed,
          pingTime: firstFragPing,
        },
        playbackInfoContext,
      );
    };

    const cleanupVideoRuntime = () => {
      if (videoRuntimeCleaned) return;
      videoRuntimeCleaned = true;
      managedVideo.__icetvSwitchToServerProxy = null;
      vodRuntimeSourceUrls.delete(video);
      clearVodStartupProgress(video);
      qualityController.dispose();
      segmentPrebufferController.dispose();
      recoveryController.dispose();
      clearStallConfirmation();
      if (speedFallbackTimer) {
        clearTimeout(speedFallbackTimer);
      }
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadeddata', tryReportVideoInfo);
    };

    assignManagedVideoCleanup(video, cleanupVideoRuntime);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTimeUpdate);

    const onHlsError = function (_event: unknown, data: any) {
      if (
        managedVideo.hls !== hls ||
        (playbackIntentRef && playbackIntentRef.current !== intent)
      )
        return;
      const errorDetails = String(data?.details || '');
      const errorReason = `${String(data?.type || 'unknown')}:${errorDetails || 'fatal'}`;
      const logResult = logHlsError(_event, data, {
        scope: 'vod',
        sourceKey: failureKey || sourceKey,
        phase: currentUseServerProxy ? 'server-proxy' : 'browser-direct',
        expectedAbort:
          videoRuntimeCleaned || isManagedVideoExpectedAbort(video),
      });
      // 已释放的运行时在复用实例上仍挂着监听，直到下一次加载解绑；此时的失败属于被放弃的地址，不能再回退路线或上报失败
      if (logResult.expectedAbort || videoRuntimeCleaned) {
        return;
      }
      // bufferFullError 非致命，hls.js 已自行降低上限并安排重下失败分片；这里只把上限压到当前前向缓冲以内，不计失败也不拉流
      bufferBudgetController.handleError(data);

      if (navigator.onLine === false || /abort/i.test(errorDetails)) return;
      const isRouteNetworkError = isVodRouteNetworkError(data);
      const isFragNetworkError =
        isRouteNetworkError && /frag|segment/i.test(errorDetails);
      const isFragOrLevelNetworkError =
        isRouteNetworkError && /frag|segment|level/i.test(errorDetails);
      if (isRouteNetworkError) {
        recoveryController.recordNetworkFailure(data.frag);
        const thresholdReached = (
          currentUseServerProxy ? serverFailureTracker : browserFailureTracker
        ).record();
        if (!isFragNetworkError || thresholdReached) {
          reportRouteStat(false);
          if (switchRoute(errorReason)) return;
          if (allowAutoFallback) {
            failCurrentSource(errorReason);
            return;
          }
        }
      }
      if (
        qualityController.tryRecoverManualSelectionFailure(
          isFragOrLevelNetworkError,
        )
      )
        return;

      if (data.fatal) {
        if (
          isRouteNetworkError &&
          currentUseServerProxy &&
          !allowAutoFallback
        ) {
          failCurrentSource(errorReason);
          return;
        }

        if (
          qualityController.tryRecoverFatalNetworkFailure({
            isFragmentNetworkError: isFragNetworkError,
            isFragmentOrLevelNetworkError: isFragOrLevelNetworkError,
          })
        ) {
          return;
        }

        const recovery = recoveryController.recover(
          {
            startLoad: resumeLoading,
            recoverMediaError: () => hls.recoverMediaError(),
            swapAudioCodec: () => hls.swapAudioCodec(),
          },
          data.type,
          Hls.ErrorTypes,
          data.frag,
        );
        if (recovery === 'recovering') {
          return;
        }
        if (recovery === 'exhausted') {
          if (!(isRouteNetworkError && switchRoute(errorReason))) {
            if (isRouteNetworkError) reportRouteStat(false);
            failCurrentSource(errorReason);
          }
          return;
        }

        cleanupVideoRuntime();
        hls.destroy();
        if (managedVideo.hls === hls) {
          managedVideo.hls = null;
          managedVideo.__icetvHlsHandlers = null;
        }
        return;
      }

      if (
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        /frag|segment|level|manifest/i.test(errorDetails)
      ) {
        setRealtimeLoadSpeed('源站响应较慢，正在继续加载');
      }
    };

    const onHlsFragLoaded = function (_: unknown, data: any) {
      markStartupProgress();
      bufferBudgetController.handleFragmentLoaded(data?.frag);
      qualityController.handleFragmentLoaded();
      segmentPrebufferController.handlePlaybackProgress();
      // 恢复时重下的失败位置之前的分片可能命中浏览器缓存，不能当作线路恢复，否则直连失败永远凑不满回退阈值
      if (recoveryController.handleFragmentLoaded(data?.frag)) {
        reportRouteStat(true);
        if (currentUseServerProxy) {
          serverFailureTracker.reset();
          if (fallbackAwaitingProgress)
            rememberSourceServerProxy(sourceKey, url);
        } else {
          browserFailureTracker.reset();
          clearSourceProxyOverride(sourceKey, url);
        }
        fallbackAwaitingProgress = false;
      }
      if (speedFallbackTimer) {
        clearTimeout(speedFallbackTimer);
        speedFallbackTimer = null;
      }
      const stats = data.frag.stats;
      const loadedBytes = stats.loaded ?? stats.total ?? 0;
      const startTime = stats.loading.first ?? 0;
      const endTime = stats.loading.end ?? 0;
      const elapsedMs = endTime > startTime ? endTime - startTime : 0;
      if (loadedBytes > 0 && elapsedMs > 0) {
        const bytesPerSecond = loadedBytes / (elapsedMs / 1000);
        const speedStr = formatBytesPerSecond(bytesPerSecond);
        setRealtimeLoadSpeed(speedStr);
        if (!firstFragSpeed) {
          firstFragSpeed = speedStr;
          firstFragPing = Math.round(performance.now() - fragLoadStart);
          tryReportVideoInfo();
        }
      } else if (loadedBytes > 0) {
        setRealtimeLoadSpeed('0 KB/s');
      }
    };

    const onHlsFragLoading = function (_: unknown, data: any) {
      const levelIndex = Number.isInteger(data?.frag?.level)
        ? Number(data.frag.level)
        : null;
      bufferBudgetController.handleFragmentLoading(data?.frag);
      qualityController.handleFragmentLoading(levelIndex);
    };

    const onHlsFragBuffered = function () {
      qualityController.handleBufferUpdated();
    };

    const onHlsLevelLoaded = function (_: unknown, data: any) {
      markStartupProgress();
      const levelIndex = Number.isInteger(data?.level)
        ? Number(data.level)
        : -1;
      const levelHeight = Number(hls.levels?.[levelIndex]?.height);
      segmentPrebufferController.handleLevelLoaded({
        fragments: data?.details?.fragments,
        levelHeight: Number.isFinite(levelHeight) ? levelHeight : undefined,
      });
    };

    // 与 onHlsError 同理，其余监听在释放后也不能再刷新速度文案、驱动画质和预缓冲或上报线路成功
    const whileRuntimeActive =
      <Args extends unknown[]>(handler: (...args: Args) => void) =>
      (...args: Args) => {
        if (
          !videoRuntimeCleaned &&
          managedVideo.hls === hls &&
          (!playbackIntentRef || playbackIntentRef.current === intent)
        )
          handler(...args);
      };
    const hlsHandlers = {
      onError: onHlsError,
      onFragLoaded: whileRuntimeActive(onHlsFragLoaded),
      onFragLoading: whileRuntimeActive(onHlsFragLoading),
      onFragBuffered: whileRuntimeActive(onHlsFragBuffered),
      onLevelLoaded: whileRuntimeActive(onHlsLevelLoaded),
      onManifestParsed: whileRuntimeActive(() => {
        markStartupProgress();
        qualityController.handleManifestParsed();
      }),
    };
    hls.on(Hls.Events.ERROR, hlsHandlers.onError);
    hls.on(Hls.Events.FRAG_LOADED, hlsHandlers.onFragLoaded);
    hls.on(Hls.Events.FRAG_LOADING, hlsHandlers.onFragLoading);
    hls.on(Hls.Events.FRAG_BUFFERED, hlsHandlers.onFragBuffered);
    hls.on(Hls.Events.LEVEL_LOADED, hlsHandlers.onLevelLoaded);
    hls.on(Hls.Events.MANIFEST_PARSED, hlsHandlers.onManifestParsed);
    managedVideo.__icetvHlsHandlers = hlsHandlers;

    video.addEventListener('loadeddata', tryReportVideoInfo);

    managedVideo.hls = hls;
    startupProgress = beginMediaLoad();
    hls.loadSource(targetUrl);
    if (!canReuseHls) {
      hls.attachMedia(video);
    }
    ensureVideoSource(video, targetUrl);
  };
}
