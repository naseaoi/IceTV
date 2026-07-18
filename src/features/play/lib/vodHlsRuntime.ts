import type Artplayer from 'artplayer';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type {
  CurrentSourceVideoInfo,
  CurrentSourceVideoInfoContext,
} from '@/features/play/hooks/artPlayerTypes';
import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';
import { shouldFilterAdsOnClient } from '@/features/play/lib/ad-filter-strategy-registry';
import { resolveSourceSwitchCurrentPlayTime } from '@/features/play/lib/episodeResumePolicy';
import {
  PLAYBACK_STALL_CONFIRMATION_DELAY_MS,
  resolvePlaybackStallDecision,
} from '@/features/play/lib/playbackStallRecovery';
import type { PlayerLoadingSessionState } from '@/features/play/lib/playerLoading';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import {
  AUTO_ROUTE_PROXY_COOLDOWN_MS,
  AUTO_ROUTE_PROXY_PROBE_TIMEOUT_MS,
  BROWSER_ROUTE_FAILURE_THRESHOLD,
  ConsecutiveRouteFailureTracker,
  SERVER_ROUTE_FAILURE_THRESHOLD,
} from '@/features/play/lib/vodAutoRoutePolicy';
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
  ensureVideoSource,
  formatBytesPerSecond,
  handleHlsFatalError,
  showTimedArtNotice,
} from '@/lib/player-utils';
import {
  clearSourceProxyOverride,
  isServerProxy,
  rememberSourceServerProxy,
  shouldAutoFallbackToServer,
} from '@/lib/proxy-modes';
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
  playbackRequestModeRef: MutableRefObject<PlaybackRequestMode>;
  resumeTimeRef: MutableRefObject<number | null>;
  resumeModeRef: MutableRefObject<ResumeMode>;
  stableCurrentTimeRef: MutableRefObject<number>;
  loadingSessionRef: MutableRefObject<PlayerLoadingSessionState>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setRealtimeLoadSpeed: Dispatch<SetStateAction<string>>;
  onSourceProxyFallbackStarted?: () => void;
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

export function createVodM3u8Loader({
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
}: CreateVodM3u8LoaderOptions) {
  return function loadVodM3u8(video: HTMLVideoElement, url: string) {
    if (!Hls) {
      console.error('HLS.js 未加载');
      return;
    }

    const managedVideo = getManagedVideo(video);

    runManagedVideoCleanup(managedVideo);

    const sourceKey = detailRef.current?.source || '';
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
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        loader: sourceLoader as typeof Hls.DefaultConfig.loader,
      });
    }
    managedVideo.__icetvClientAdFilter = useClientAdFilter;
    managedVideo.__icetvFragmentHttpCacheRecovery = fragmentHttpCacheRecovery;

    const buildTargetUrl = (rawUrl: string, useServerProxy: boolean) =>
      buildVodProxyUrl({
        rawUrl,
        useServerProxy,
        sourceKey,
        playbackRequestMode: playbackRequestModeRef.current || 'initial',
      });

    let currentUseServerProxy = isServerProxy(sourceKey, url);
    let targetUrl = buildTargetUrl(url, currentUseServerProxy);
    managedVideo.__icetvUsingServerProxy = currentUseServerProxy;
    const segmentPrebufferController = createVodSegmentPrebufferController({
      getCurrentTime: () => video.currentTime || 0,
      isServerProxy: () => currentUseServerProxy,
      sourceKey,
    });
    const browserFailureTracker = new ConsecutiveRouteFailureTracker(
      BROWSER_ROUTE_FAILURE_THRESHOLD,
    );
    const serverFailureTracker = new ConsecutiveRouteFailureTracker(
      SERVER_ROUTE_FAILURE_THRESHOLD,
    );
    let videoRuntimeCleaned = false;
    let proxyProbeInFlight = false;
    let proxyProbeSequence = 0;
    let proxyProbeController: AbortController | null = null;
    let proxyRetryBlockedUntil = 0;
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
    const stopWithSourceError = () => {
      if (typeof hls.stopLoad === 'function') {
        hls.stopLoad();
      }
      setIsVideoLoading(false);
      setRealtimeLoadSpeed('');
      if (sourceKey) {
        clearSourceProxyOverride(sourceKey, url);
      }
      reportRouteStat(false);
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
        !shouldAutoFallbackToServer(sourceKey)
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
        targetUrl = fallbackTargetUrl;
        managedVideo.__icetvUsingServerProxy = true;
        browserFailureTracker.reset();
        serverFailureTracker.reset();
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
        !shouldAutoFallbackToServer(sourceKey)
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
      hls.loadSource(directTargetUrl);
      ensureVideoSource(video, directTargetUrl);
      return true;
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
        !shouldAutoFallbackToServer(sourceKey) ||
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
        AUTO_ROUTE_PROXY_PROBE_TIMEOUT_MS,
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
          if (typeof hls.startLoad === 'function') {
            hls.startLoad();
          }
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
    managedVideo.__icetvSwitchToServerProxy = (reason: string) =>
      requestServerProxyFallback(reason, null);

    const getBufferedRanges = () => {
      const ranges: Array<[number, number]> = [];
      for (let i = 0; i < video.buffered.length; i += 1) {
        ranges.push([video.buffered.start(i), video.buffered.end(i)]);
      }
      return ranges;
    };

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

        setRealtimeLoadSpeed('源站响应较慢，正在继续加载');
        try {
          const activePlayer = artPlayerRef.current;
          if (activePlayer) {
            showTimedArtNotice(activePlayer, '源站响应较慢，正在继续加载');
          }
        } catch {}
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
      qualityController.dispose();
      segmentPrebufferController.dispose();
      clearStallConfirmation();
      if (speedFallbackTimer) {
        clearTimeout(speedFallbackTimer);
      }
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('loadeddata', tryReportVideoInfo);
    };

    assignManagedVideoCleanup(video, cleanupVideoRuntime);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('playing', onPlaying);

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
      if (logResult.expectedAbort) {
        return;
      }

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
          if (
            (data.fatal || serverFailureThresholdReached) &&
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
          stopWithSourceError();
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

        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          currentUseServerProxy &&
          !loadingSessionRef.current.playbackStartNotified
        ) {
          if (typeof hls.stopLoad === 'function') {
            hls.stopLoad();
          }
          setIsVideoLoading(false);
          setRealtimeLoadSpeed('');
          if (sourceKey) {
            clearSourceProxyOverride(sourceKey, url);
          }
          reportRouteStat(false);
          setError('当前源加载失败');
          return;
        }

        handleHlsFatalError(
          {
            startLoad: () => hls.startLoad(),
            recoverMediaError: () => hls.recoverMediaError(),
            destroy: () => {
              cleanupVideoRuntime();
              hls.destroy();
              if (managedVideo.hls === hls) {
                managedVideo.hls = null;
                managedVideo.__icetvHlsHandlers = null;
              }
            },
          },
          data.type,
          Hls.ErrorTypes,
        );
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
      qualityController.handleFragmentLoaded();
      segmentPrebufferController.handlePlaybackProgress();
      if (currentUseServerProxy) {
        serverFailureTracker.reset();
      } else {
        browserFailureTracker.reset();
        cancelProxyProbe();
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
      qualityController.handleFragmentLoading(levelIndex);
    };

    const onHlsFragBuffered = function () {
      qualityController.handleBufferUpdated();
    };

    const onHlsLevelLoaded = function (_: unknown, data: any) {
      const levelIndex = Number.isInteger(data?.level)
        ? Number(data.level)
        : -1;
      const levelHeight = Number(hls.levels?.[levelIndex]?.height);
      segmentPrebufferController.handleLevelLoaded({
        fragments: data?.details?.fragments,
        levelHeight: Number.isFinite(levelHeight) ? levelHeight : undefined,
      });
    };

    hls.on(Hls.Events.ERROR, onHlsError);
    hls.on(Hls.Events.FRAG_LOADED, onHlsFragLoaded);
    hls.on(Hls.Events.FRAG_LOADING, onHlsFragLoading);
    hls.on(Hls.Events.FRAG_BUFFERED, onHlsFragBuffered);
    hls.on(Hls.Events.LEVEL_LOADED, onHlsLevelLoaded);
    const onManifestParsed = () => {
      qualityController.handleManifestParsed();
    };
    hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
    managedVideo.__icetvHlsHandlers = {
      onError: onHlsError,
      onFragLoaded: onHlsFragLoaded,
      onFragLoading: onHlsFragLoading,
      onFragBuffered: onHlsFragBuffered,
      onLevelLoaded: onHlsLevelLoaded,
      onManifestParsed,
    };

    video.addEventListener('loadeddata', tryReportVideoInfo);

    hls.loadSource(targetUrl);
    if (!canReuseHls) {
      hls.attachMedia(video);
    }
    managedVideo.hls = hls;
    ensureVideoSource(video, targetUrl);
  };
}
