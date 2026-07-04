import type Artplayer from 'artplayer';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { SearchResult } from '@/lib/types';
import {
  clearSourceFailure,
  markSourceFailed,
} from '@/lib/failed-source-cooldown';
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
  HLS_START_LEVEL_STRATEGY,
  pickStartLevelFromStrategy,
} from '@/lib/player-utils';
import {
  clearSourceProxyOverride,
  isServerProxy,
  rememberSourceServerProxy,
  shouldAutoFallbackToServer,
} from '@/lib/proxy-modes';

import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';
import type {
  CurrentSourceVideoInfo,
  CurrentSourceVideoInfoContext,
} from '@/features/play/hooks/artPlayerTypes';
import { resolveSourceSwitchCurrentPlayTime } from '@/features/play/lib/episodeResumePolicy';
import {
  applyAutoQualityLevel,
  applyManualQualityLevel,
  findPreferredLevelIndex,
  markQualityControlTemporaryAuto,
  registerQualityControlWhenReady,
} from '@/features/play/lib/hlsQuality';
import type { PlayerLoadingSessionState } from '@/features/play/lib/playerLoading';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import {
  getHlsErrorStatus,
  resolveHlsSourceFailureReason,
} from '@/features/play/lib/hlsSourceFailure';
import { buildVodProxyUrl } from '@/features/play/lib/vodProxyUrl';

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

    const currentBlockAd = blockAdEnabledRef.current;
    const existingHls = managedVideo.hls;
    const canReuseHls =
      !!existingHls && managedVideo.__icetvBlockAd === currentBlockAd;

    let hls: any;
    if (canReuseHls) {
      hls = existingHls;
      const oldHandlers = managedVideo.__icetvHlsHandlers;
      if (oldHandlers) {
        hls.off(Hls.Events.ERROR, oldHandlers.onError);
        hls.off(Hls.Events.FRAG_LOADED, oldHandlers.onFragLoaded);
        if (oldHandlers.onManifestParsed) {
          hls.off(Hls.Events.MANIFEST_PARSED, oldHandlers.onManifestParsed);
        }
      }
    } else {
      destroyManagedHls(managedVideo);
      hls = new Hls({
        ...createHlsConfig({
          maxBufferLength: 30,
          maxMaxBufferLength: 120,
          backBufferLength: 30,
          preserveManualLevelOnError: true,
        }),
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: 1,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 6000,
        levelLoadingMaxRetry: 1,
        levelLoadingRetryDelay: 500,
        fragLoadingTimeOut: 8000,
        fragLoadingMaxRetry: 2,
        fragLoadingRetryDelay: 500,
        loader: currentBlockAd
          ? (adBlockingHlsLoader as unknown as typeof Hls.DefaultConfig.loader)
          : Hls.DefaultConfig.loader,
      });
    }
    managedVideo.__icetvBlockAd = currentBlockAd;

    const sourceKey = detailRef.current?.source || '';
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
    let qualityLockProbeTimer: ReturnType<typeof setTimeout> | null = null;
    const clearQualityLockProbe = () => {
      if (qualityLockProbeTimer) {
        clearTimeout(qualityLockProbeTimer);
        qualityLockProbeTimer = null;
      }
    };
    const releaseQualityLockToAuto = () => {
      applyAutoQualityLevel(hls);
      hls.startLoad();
      markQualityControlTemporaryAuto(artPlayerRef, hls);
      setRealtimeLoadSpeed('所选画质加载失败，已临时切回自动');
      try {
        const activePlayer = artPlayerRef.current;
        if (activePlayer) {
          activePlayer.notice.show = '所选画质加载失败，已临时切回自动';
        }
      } catch {}
    };
    const failureKey =
      playbackInfoContext.source && playbackInfoContext.id
        ? `${playbackInfoContext.source}-${playbackInfoContext.id}`
        : '';

    const markCurrentSourceFailure = (
      reason: string,
      message?: string,
      status?: number,
    ) => {
      if (!failureKey) return;
      markSourceFailed(failureKey, {
        reason,
        message,
        status,
      });
    };

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

    const switchToServerProxy = (reason: string) => {
      if (
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
      setRealtimeLoadSpeed('直连失败，切换代理...');
      markCurrentSourceFailure('cors-fallback', reason);

      try {
        if (sourceKey) {
          rememberSourceServerProxy(sourceKey, url);
        }
        currentUseServerProxy = true;
        targetUrl = fallbackTargetUrl;
        managedVideo.__icetvUsingServerProxy = true;
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
    managedVideo.__icetvSwitchToServerProxy = switchToServerProxy;

    const getBufferedRanges = () => {
      const ranges: Array<[number, number]> = [];
      for (let i = 0; i < video.buffered.length; i += 1) {
        ranges.push([video.buffered.start(i), video.buffered.end(i)]);
      }
      return ranges;
    };

    const tryRecoverPlaybackStall = (reason: 'waiting' | 'stalled') => {
      if (video.paused || video.ended) {
        return;
      }

      const currentTime = video.currentTime || 0;
      const ranges = getBufferedRanges();
      const activeRange = ranges.find(
        ([start, end]) => currentTime >= start && currentTime < end,
      );
      const nextRange = ranges.find(([start]) => start > currentTime);
      const bufferedAhead = activeRange ? activeRange[1] - currentTime : 0;
      const gapToNext = nextRange
        ? nextRange[0] - (activeRange ? activeRange[1] : currentTime)
        : null;

      console.warn('检测到点播播放卡顿，尝试恢复', {
        reason,
        currentTime: Number(currentTime.toFixed(2)),
        readyState: video.readyState,
        networkState: video.networkState,
        bufferedAhead: Number(bufferedAhead.toFixed(2)),
        gapToNext: gapToNext === null ? null : Number(gapToNext.toFixed(2)),
        bufferedRanges: ranges.map(([start, end]) => [
          Number(start.toFixed(2)),
          Number(end.toFixed(2)),
        ]),
      });
      setRealtimeLoadSpeed('当前源加载慢，尝试恢复...');
      try {
        const activePlayer = artPlayerRef.current;
        if (activePlayer) {
          activePlayer.notice.show = '当前源加载慢，尝试恢复...';
        }
      } catch {}

      const now = Date.now();
      if (now - lastStallRecoveryAt < 1500) {
        return;
      }
      lastStallRecoveryAt = now;

      if (bufferedAhead > 1.5) {
        video.currentTime = Math.min(
          currentTime + 0.1,
          activeRange ? activeRange[1] - 0.05 : currentTime + 0.1,
        );
        return;
      }

      if (nextRange && gapToNext !== null && gapToNext > 0 && gapToNext <= 1) {
        video.currentTime = nextRange[0] + 0.05;
        return;
      }

      hls.startLoad();
    };

    const onWaiting = () => {
      tryRecoverPlaybackStall('waiting');
    };
    const onStalled = () => {
      tryRecoverPlaybackStall('stalled');
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

    let videoRuntimeCleaned = false;
    const cleanupVideoRuntime = () => {
      if (videoRuntimeCleaned) return;
      videoRuntimeCleaned = true;
      clearQualityLockProbe();
      if (speedFallbackTimer) {
        clearTimeout(speedFallbackTimer);
      }
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('loadeddata', tryReportVideoInfo);
    };

    assignManagedVideoCleanup(video, cleanupVideoRuntime);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);

    const onHlsError = function (_event: unknown, data: any) {
      const errorStatus = getHlsErrorStatus(data);
      const errorDetails = String(data?.details || '');
      const errorReason = `${String(data?.type || 'unknown')}:${errorDetails || 'fatal'}`;
      const sourceFailureReason = resolveHlsSourceFailureReason(
        data,
        currentUseServerProxy,
        Hls.ErrorTypes,
      );
      const logResult = logHlsError(_event, data, {
        scope: 'vod',
        sourceKey: failureKey || sourceKey,
        phase: currentUseServerProxy ? 'server-proxy' : 'browser-direct',
        expectedAbort:
          videoRuntimeCleaned ||
          isManagedVideoExpectedAbort(video) ||
          playbackRequestModeRef.current !== 'initial',
      });
      if (logResult.expectedAbort) {
        return;
      }

      if (data.fatal) {
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          hls.autoLevelEnabled === false &&
          hls.__icetvManualQualityLocked !== true &&
          /frag|level/i.test(errorDetails)
        ) {
          clearQualityLockProbe();
          releaseQualityLockToAuto();
          return;
        }

        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          switchToServerProxy(errorReason)
        ) {
          return;
        }

        markCurrentSourceFailure(sourceFailureReason, errorReason, errorStatus);

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
        markCurrentSourceFailure(sourceFailureReason, errorReason, errorStatus);
        setRealtimeLoadSpeed('当前源加载慢，尝试恢复...');
      }
    };

    const onHlsFragLoaded = function (_: unknown, data: any) {
      clearQualityLockProbe();
      if (speedFallbackTimer) {
        clearTimeout(speedFallbackTimer);
        speedFallbackTimer = null;
      }
      if (failureKey) {
        clearSourceFailure(failureKey);
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

    hls.on(Hls.Events.ERROR, onHlsError);
    hls.on(Hls.Events.FRAG_LOADED, onHlsFragLoaded);
    const onManifestParsed = (_evt: unknown, rawData: unknown) => {
      const data = rawData as { levels?: unknown[] } | null;
      const levelCount = Array.isArray(data?.levels) ? data.levels.length : 0;
      const preferredLevel = findPreferredLevelIndex(hls.levels || []);
      if (preferredLevel !== null) {
        applyManualQualityLevel(hls, preferredLevel);
        clearQualityLockProbe();
        qualityLockProbeTimer = setTimeout(() => {
          qualityLockProbeTimer = null;
          if (
            hls.autoLevelEnabled === false &&
            hls.__icetvManualQualityLocked !== true
          ) {
            releaseQualityLockToAuto();
          }
        }, 10000);
      } else {
        const picked = pickStartLevelFromStrategy(
          HLS_START_LEVEL_STRATEGY,
          levelCount,
        );
        if (picked !== undefined) {
          hls.startLevel = picked;
          hls.nextLevel = picked;
        }
      }
      registerQualityControlWhenReady(artPlayerRef, hls);
    };
    hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
    managedVideo.__icetvHlsHandlers = {
      onError: onHlsError,
      onFragLoaded: onHlsFragLoaded,
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
