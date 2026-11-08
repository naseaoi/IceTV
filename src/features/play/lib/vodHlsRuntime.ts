import type Artplayer from 'artplayer';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type {
  CurrentSourceVideoInfo,
  CurrentSourceVideoInfoContext,
} from '@/features/play/hooks/artPlayerTypes';
import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';
import { shouldFilterAdsOnClient } from '@/features/play/lib/ad-filter-strategy-registry';
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
  AUTO_ROUTE_PROXY_COOLDOWN_MS,
  BROWSER_ROUTE_FAILURE_THRESHOLD,
  buildVodFragLoadPolicy,
  ConsecutiveRouteFailureTracker,
  resolveAutoRouteFailureWindowMs,
  resolveAutoRouteProxyProbeTimeoutMs,
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
  buildVodProxyUrl,
  buildVodSegmentProxyUrl,
} from '@/features/play/lib/vodProxyUrl';
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
  isServerProxy,
  rememberSourceServerProxy,
  shouldAutoFallbackToServer,
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
export function registerVodNativeRuntime(video: HTMLVideoElement, url: string) {
  vodRuntimeSourceUrls.set(video, url);
  let progress = beginVodStartupProgress(video, '');
  let bufferedEnd = 0;
  const onLoadStart = () => {
    bufferedEnd = 0;
    progress = beginVodStartupProgress(video, '');
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
  video.addEventListener('loadstart', onLoadStart);
  video.addEventListener('progress', onProgress);
  video.addEventListener('loadedmetadata', onLoadedMetadata);
  assignManagedVideoCleanup(video, () => {
    vodRuntimeSourceUrls.delete(video);
    clearVodStartupProgress(video);
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

    const managedVideo = getManagedVideo(video);

    runManagedVideoCleanup(managedVideo);

    const sourceKey = detailRef.current?.source || '';
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
    const currentBlockAd = blockAdEnabledRef.current;
    const useClientAdFilter =
      currentBlockAd && shouldFilterAdsOnClient(sourceKey);
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
      return progress;
    };
    let startupProgress: ReturnType<typeof beginMediaLoad> | null = null;
    const markStartupProgress = () => {
      if (startupProgress) startupProgress.lastProgressAt = performance.now();
    };

    const buildTargetUrl = (rawUrl: string, useServerProxy: boolean) =>
      buildVodProxyUrl({
        rawUrl,
        useServerProxy,
        sourceKey,
        playbackRequestMode: playbackRequestModeRef.current || 'initial',
      });

    const playbackRoute = playbackRouteRef?.current;
    const allowAutoFallback =
      playbackRoute?.allowAutoFallback ?? shouldAutoFallbackToServer(sourceKey);
    let currentUseServerProxy =
      playbackRoute?.useServerProxy ?? isServerProxy(sourceKey, url);
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
    let proxyProbeInFlight = false;
    let proxyProbeSequence = 0;
    let proxyProbeController: AbortController | null = null;
    let proxyRetryBlockedUntil = 0;
    let serverFallbackAttempted = false;
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
      if (sourceKey) {
        clearSourceProxyOverride(sourceKey, url);
      }
      reportRouteStat(false);
      if (onPlaybackRecoveryExhausted?.(reason)) {
        return;
      }
      // 自动换源接手时由换源流程释放；否则先取消恢复与探测，再停止加载，保留实例供手动重试。
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

    const cancelProxyProbe = () => {
      if (!proxyProbeInFlight && !proxyProbeController) {
        return;
      }
      proxyProbeSequence += 1;
      proxyProbeController?.abort();
      proxyProbeController = null;
      proxyProbeInFlight = false;
    };

    const switchToServerProxy = (reason: string) => {
      if (
        videoRuntimeCleaned ||
        managedVideo.hls !== hls ||
        currentUseServerProxy ||
        !sourceKey ||
        !allowAutoFallback
      ) {
        return false;
      }

      const fallbackTargetUrl = buildTargetUrl(url, true);
      console.warn('浏览器直连起播失败，切换服务端代理重试', {
        sourceKey,
        reason,
      });
      reportRouteStat(false);
      setRealtimeLoadSpeed('直连失败，切换代理...');
      segmentPrebufferController.dispose();

      try {
        if (sourceKey) {
          rememberSourceServerProxy(sourceKey, url);
        }
        currentUseServerProxy = true;
        serverFallbackAttempted = true;
        targetUrl = fallbackTargetUrl;
        managedVideo.__icetvUsingServerProxy = true;
        browserFailureTracker.reset();
        serverFailureTracker.reset();
        recoveryController.reset();
        firstFragSpeed = '';
        firstFragPing = 0;
        videoInfoReported = false;
        fragLoadStart = performance.now();
        setRealtimeLoadSpeed('代理加载中...');
        resetSpeedFallbackTimer();
        preservePlaybackPositionBeforeReload();
        onSourceProxyFallbackStarted?.();
        if (typeof hls.stopLoad === 'function') {
          markManagedVideoExpectedAbort(video);
          hls.stopLoad();
        }
        startupProgress = beginMediaLoad();
        hls.loadSource(fallbackTargetUrl);
        ensureVideoSource(video, fallbackTargetUrl);
        return true;
      } catch (error) {
        console.error('切换服务端代理失败:', error);
        return false;
      }
    };

    const switchToBrowserDirect = (reason: string) => {
      if (
        videoRuntimeCleaned ||
        managedVideo.hls !== hls ||
        !currentUseServerProxy ||
        !sourceKey ||
        !allowAutoFallback
      ) {
        return false;
      }

      const directTargetUrl = buildTargetUrl(url, false);
      console.warn('服务端代理连续加载失败，切回浏览器直连', {
        sourceKey,
        reason,
      });
      reportRouteStat(false);
      clearSourceProxyOverride(sourceKey, url);
      currentUseServerProxy = false;
      targetUrl = directTargetUrl;
      managedVideo.__icetvUsingServerProxy = false;
      proxyRetryBlockedUntil = Date.now() + AUTO_ROUTE_PROXY_COOLDOWN_MS;
      browserFailureTracker.reset();
      serverFailureTracker.reset();
      recoveryController.reset();
      firstFragSpeed = '';
      firstFragPing = 0;
      videoInfoReported = false;
      fragLoadStart = performance.now();
      setRealtimeLoadSpeed('代理响应较慢，切回浏览器直连...');
      resetSpeedFallbackTimer();
      preservePlaybackPositionBeforeReload();
      onSourceProxyFallbackStarted?.();
      if (typeof hls.stopLoad === 'function') {
        markManagedVideoExpectedAbort(video);
        hls.stopLoad();
      }
      startupProgress = beginMediaLoad();
      hls.loadSource(directTargetUrl);
      ensureVideoSource(video, directTargetUrl);
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

    const requestServerProxyFallback = (
      reason: string,
      segmentUrl: string | null,
    ) => {
      if (
        videoRuntimeCleaned ||
        managedVideo.hls !== hls ||
        currentUseServerProxy ||
        !sourceKey ||
        !allowAutoFallback ||
        Date.now() < proxyRetryBlockedUntil
      ) {
        return false;
      }
      if (proxyProbeInFlight) {
        return true;
      }

      proxyProbeInFlight = true;
      const probeSequence = proxyProbeSequence + 1;
      proxyProbeSequence = probeSequence;
      const controller = new AbortController();
      proxyProbeController = controller;
      const probeTimer = setTimeout(
        () => controller.abort(),
        resolveAutoRouteProxyProbeTimeoutMs(fragmentTimeoutMs),
      );
      const probeUrl = segmentUrl
        ? buildVodSegmentProxyUrl({
            rawUrl: segmentUrl,
            sourceKey,
            playbackRequestMode: playbackRequestModeRef.current || 'initial',
          })
        : buildTargetUrl(url, true);

      setRealtimeLoadSpeed('直连连续失败，正在检测代理...');
      void (async () => {
        try {
          const response = await fetch(probeUrl, {
            cache: 'no-store',
            headers: segmentUrl ? { Range: 'bytes=0-65535' } : undefined,
            signal: controller.signal,
          });
          if (!response.ok) {
            return false;
          }
          if (segmentUrl) {
            const reader = response.body?.getReader();
            if (!reader) {
              return false;
            }
            const chunk = await reader.read();
            await reader.cancel().catch(() => {});
            return !chunk.done && !!chunk.value?.byteLength;
          }
          const content = await response.text();
          return content.includes('#EXTM3U');
        } catch {
          return false;
        } finally {
          clearTimeout(probeTimer);
        }
      })()
        .then((proxyHealthy) => {
          if (
            probeSequence !== proxyProbeSequence ||
            videoRuntimeCleaned ||
            managedVideo.hls !== hls
          ) {
            return;
          }
          if (proxyHealthy) {
            switchToServerProxy(reason);
            return;
          }
          browserFailureTracker.reset();
          proxyRetryBlockedUntil = Date.now() + AUTO_ROUTE_PROXY_COOLDOWN_MS;
          setRealtimeLoadSpeed('代理响应较慢，继续浏览器直连');
          resumeLoading();
        })
        .finally(() => {
          if (probeSequence !== proxyProbeSequence) {
            return;
          }
          proxyProbeController = null;
          proxyProbeInFlight = false;
        });
      return true;
    };
    // 页面超时与恢复耗尽时直接切服务端不再探测，每次加载只试一次；成功时 onSourceProxyFallbackStarted 会重置页面超时计时。
    // 不受探测冷却限制：探测慢只说明代理慢，此时直连已确定走不通，慢代理也好过停在超时
    const startServerFallbackNow = (reason: string) => {
      if (serverFallbackAttempted) {
        return false;
      }
      cancelProxyProbe();
      return switchToServerProxy(reason);
    };
    managedVideo.__icetvSwitchToServerProxy = startServerFallbackNow;
    registerStartupStateDescriber(video, 'route', () => ({
      allowAutoFallback,
      currentUseServerProxy,
      serverFallbackAttempted,
      proxyProbeInFlight,
      proxyCooldownRemainingMs: Math.max(
        0,
        proxyRetryBlockedUntil - Date.now(),
      ),
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
      cancelProxyProbe();
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

      const isFragOrLevelNetworkError =
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        /frag|segment|level/i.test(errorDetails);
      const isFragNetworkError =
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        /frag|segment/i.test(errorDetails);
      const isManifestOrLevelNetworkError =
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        /manifest|level/i.test(errorDetails);
      const isRouteNetworkError =
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        /frag|segment|level|manifest/i.test(errorDetails);
      let browserFailureThresholdReached = false;

      if (isRouteNetworkError) {
        if (currentUseServerProxy) {
          const serverFailureThresholdReached = serverFailureTracker.record();
          // 起播前刚从直连回退过来就不再切回直连，否则两条路线会来回切到页面超时
          const canReturnToBrowser =
            !serverFallbackAttempted ||
            loadingSessionRef.current.playbackStartNotified;
          if (
            (data.fatal || serverFailureThresholdReached) &&
            canReturnToBrowser &&
            switchToBrowserDirect(errorReason)
          ) {
            return;
          }
        } else {
          browserFailureThresholdReached = browserFailureTracker.record();
        }
      }

      if (
        qualityController.tryRecoverManualSelectionFailure(
          isFragOrLevelNetworkError,
        )
      ) {
        return;
      }

      if (
        !currentUseServerProxy &&
        (browserFailureThresholdReached ||
          (data.fatal && isManifestOrLevelNetworkError)) &&
        requestServerProxyFallback(
          errorReason,
          isFragNetworkError && data?.frag?.url ? String(data.frag.url) : null,
        )
      ) {
        return;
      }

      if (data.fatal) {
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          currentUseServerProxy
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
          if (!startServerFallbackNow(errorReason)) {
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
        if (currentUseServerProxy) {
          serverFailureTracker.reset();
        } else {
          browserFailureTracker.reset();
          cancelProxyProbe();
        }
      }
      if (speedFallbackTimer) {
        clearTimeout(speedFallbackTimer);
        speedFallbackTimer = null;
      }
      reportRouteStat(true);
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
        if (!videoRuntimeCleaned) handler(...args);
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
