import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useEffect,
  useRef,
} from 'react';

import { SearchResult } from '@/lib/types';
import {
  clearSourceFailure,
  markSourceFailed,
} from '@/lib/failed-source-cooldown';
import {
  clearSourceProxyOverride,
  isServerProxy,
  rememberSourceServerProxy,
} from '@/lib/proxy-modes';
import {
  assignManagedVideoCleanup,
  createHlsLoaderClass,
  destroyManagedHls,
  getManagedVideo,
  getPlayerModules,
  isManagedVideoExpectedAbort,
  markManagedVideoExpectedAbort,
  prefetchM3U8,
  runManagedVideoCleanup,
} from '@/lib/player-runtime';
import { preconnectForUrl } from '@/lib/preconnect';
import { logHlsError } from '@/lib/hls-error-log';
import {
  ensureVideoSource,
  formatTime,
  formatBytesPerSecond,
  createHlsConfig,
  createArtPlayerConfig,
  configureArtplayerStatics,
  handleHlsFatalError,
  HLS_START_LEVEL_STRATEGY,
  pickStartLevelFromStrategy,
} from '@/lib/player-utils';

import {
  hasReachedResumeTarget,
  markPlayerLoadingSessionStarted,
  PlayerLoadingSessionState,
  resetPlayerLoadingSessionState,
  shouldDismissLoadingFromCanPlay,
  shouldDismissLoadingFromReadyFrame,
} from '@/features/play/lib/playerLoading';
import { WakeLockSentinel } from '@/features/play/lib/playTypes';
import { filterAdsFromM3U8 } from '@/features/play/lib/playUtils';
import { resolveNextStablePlaybackTime } from '@/features/play/hooks/usePlayProgress';
import { resolveSourceSwitchCurrentPlayTime } from '@/features/play/lib/episodeResumePolicy';
import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';
import {
  applyResumeTime,
  isWithinAutoResumeWindow,
  resolvePendingResumeTime,
  resolveResumeTimeTarget,
  shouldForcePlaybackStartFromHead,
} from '@/features/play/lib/resumePlayback';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

type HlsErrorTypes = {
  NETWORK_ERROR: string;
  MEDIA_ERROR: string;
};

function getHlsErrorStatus(data: any): number | undefined {
  const candidates = [
    data?.response?.code,
    data?.response?.status,
    data?.networkDetails?.status,
  ];
  for (const item of candidates) {
    const status = Number(item);
    if (Number.isFinite(status) && status > 0) {
      return status;
    }
  }
  return undefined;
}

function getHlsErrorText(data: any): string {
  return [
    data?.type,
    data?.details,
    data?.error?.message,
    data?.response?.text,
    data?.networkDetails?.statusText,
  ]
    .filter(Boolean)
    .join(' ');
}

function resolveHlsSourceFailureReason(
  data: any,
  usingServerProxy: boolean,
  errorTypes: HlsErrorTypes,
): string {
  const status = getHlsErrorStatus(data);
  const text = getHlsErrorText(data).toLowerCase();
  if (status && status >= 500 && usingServerProxy) return `proxy-${status}`;
  if (text.includes('err_connection_closed')) return 'connection-closed';
  if (text.includes('connection_closed')) return 'connection-closed';
  if (!usingServerProxy && data?.type === errorTypes.NETWORK_ERROR) {
    return 'cors';
  }
  if (usingServerProxy && data?.type === errorTypes.NETWORK_ERROR) {
    return 'proxy-error';
  }
  if (text.includes('frag') || text.includes('segment')) {
    return 'segment-failed';
  }
  if (text.includes('manifest')) return 'manifest-failed';
  if (text.includes('level')) return 'playlist-failed';
  if (data?.type === errorTypes.MEDIA_ERROR) return 'hls-media';
  if (data?.type === errorTypes.NETWORK_ERROR) return 'hls-network';
  return 'hls-fatal';
}

export interface UseArtPlayerParams {
  artRef: MutableRefObject<HTMLDivElement | null>;
  artPlayerRef: MutableRefObject<Artplayer | null>;
  videoUrl: string;
  videoCover: string;
  videoTitle: string;
  loading: boolean;
  detail: SearchResult | null;
  currentEpisodeIndex: number;
  totalEpisodes: number;
  blockAdEnabled: boolean;
  blockAdEnabledRef: MutableRefObject<boolean>;
  skipConfigRef: MutableRefObject<SkipConfig>;
  resumeTimeRef: MutableRefObject<number | null>;
  resumeModeRef: MutableRefObject<ResumeMode>;
  allowAutoResumeRef: MutableRefObject<boolean>;
  stableCurrentTimeRef: MutableRefObject<number>;
  clearTargetEpisodeProgressRef: MutableRefObject<boolean>;
  playbackRequestModeRef: MutableRefObject<PlaybackRequestMode>;
  lastVolumeRef: MutableRefObject<number>;
  lastPlaybackRateRef: MutableRefObject<number>;
  lastSkipCheckRef: MutableRefObject<number>;
  lastSaveTimeRef: MutableRefObject<number>;
  detailRef: MutableRefObject<SearchResult | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  wakeLockRef: MutableRefObject<WakeLockSentinel | null>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setRealtimeLoadSpeed: Dispatch<SetStateAction<string>>;
  setBlockAdEnabled: Dispatch<SetStateAction<boolean>>;
  handleNextEpisode: () => void;
  handleSkipConfigChange: (newConfig: SkipConfig) => Promise<void>;
  saveCurrentPlayProgress: () => void;
  requestWakeLock: () => Promise<void>;
  releaseWakeLock: () => Promise<void>;
  cleanupPlayer: () => void;
  onPlaybackStarted?: () => void;
  /** 当前源从 browser 回退到 server 前触发，用于重置同源重试超时窗口。 */
  onSourceProxyFallbackStarted?: () => void;
  /** 播放器收集到当前源的测速数据后回调（速度+分辨率+延迟） */
  onCurrentSourceVideoInfo?: (
    info: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    context: {
      source: string;
      id: string;
      videoUrl: string;
    },
  ) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useArtPlayer(params: UseArtPlayerParams) {
  const {
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
    requestWakeLock,
    releaseWakeLock,
    cleanupPlayer,
    onPlaybackStarted,
    onSourceProxyFallbackStarted,
    onCurrentSourceVideoInfo,
  } = params;
  const loadingSessionRef = useRef<PlayerLoadingSessionState>({
    pendingInitialResumeTarget: null,
    playbackStartNotified: false,
  });
  // 新一集真正起播前，不允许再次触发自动切集，避免旧媒体尾部事件串到新一集。
  const autoAdvanceArmedRef = useRef<boolean>(false);
  // 当前集是否已触发过自动切下一集，避免 ended/timeupdate/跳片尾 多通道重复点
  const autoAdvancedRef = useRef<boolean>(false);

  // --- 主 useEffect ---

  useEffect(() => {
    if (
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }

    let cancelled = false;
    // 每次主 effect 重新跑（含切集触发的 videoUrl 变化）都先关闭自动切集，
    // 等新一集真正起播后再放行，避免同一个播放器实例补发上一集的 ended/timeupdate。
    autoAdvanceArmedRef.current = false;
    autoAdvancedRef.current = false;

    const initPlayer = async () => {
      try {
        // 预取 m3u8 清单（与模块加载并行），填充服务端缓存
        const preSourceKey = detailRef.current?.source || '';
        const playbackInfoContext = {
          source: detailRef.current?.source || detail?.source || '',
          id: detailRef.current?.id || detail?.id || '',
          videoUrl,
        };
        const preUseProxy = isServerProxy(preSourceKey);
        const appendPlaybackRequestContext = (params: URLSearchParams) => {
          const mode = playbackRequestModeRef.current || 'initial';
          params.set('icetv-switch', mode);
          params.set('icetv-user-switch', mode === 'manual-source' ? '1' : '0');
        };
        const buildProxyUrl = (rawUrl: string) => {
          const params = new URLSearchParams({ url: rawUrl });
          if (preUseProxy) {
            params.set('forceServer', 'true');
          } else {
            params.set('allowCORS', 'true');
          }
          if (preSourceKey) {
            params.set('icetv-source', preSourceKey);
          }
          appendPlaybackRequestContext(params);
          return `/api/proxy/m3u8?${params.toString()}`;
        };

        const preM3u8Url = buildProxyUrl(videoUrl);
        prefetchM3U8(preM3u8Url);

        // 源站 preconnect：
        // - allowCORS 模式下 ts 分片直连源站，DNS+TLS 握手省 100~400ms
        // - 即便走服务端代理，Node 进程回源时也受益于浏览器侧提前解析
        preconnectForUrl(videoUrl);

        // 下一集 m3u8 预取：切集瞬开（服务端 SWR 缓存 + 浏览器 HTTP 缓存双命中）
        const nextEpisodeUrl =
          detail?.episodes?.[currentEpisodeIndex + 1] ?? null;
        if (nextEpisodeUrl) {
          prefetchM3U8(buildProxyUrl(nextEpisodeUrl));
          preconnectForUrl(nextEpisodeUrl);
        }

        const { Artplayer, Hls } = await getPlayerModules();
        if (cancelled || !artRef.current) return;

        const isWebkit =
          typeof window !== 'undefined' &&
          typeof (window as unknown as Record<string, unknown>)
            .webkitConvertPointFromNodeToPage === 'function';

        // 非WebKit浏览器且播放器已存在，使用switch方法切换
        if (!isWebkit && artPlayerRef.current) {
          resetPlayerLoadingSessionState(loadingSessionRef.current);
          artPlayerRef.current.switch = videoUrl;
          artPlayerRef.current.title = `${videoTitle} - 第${currentEpisodeIndex + 1}集`;
          if (artPlayerRef.current?.video) {
            ensureVideoSource(
              artPlayerRef.current.video as HTMLVideoElement,
              videoUrl,
            );
          }
          return;
        }

        // WebKit浏览器或首次创建
        if (artPlayerRef.current) {
          cleanupPlayer();
        }
        resetPlayerLoadingSessionState(loadingSessionRef.current);

        const AdBlockingHlsLoader = createHlsLoaderClass(
          Hls.DefaultConfig.loader as unknown as new (config: unknown) => {
            load: (...args: unknown[]) => void;
          },
          {
            transformManifestText: (content) => filterAdsFromM3U8(content),
          },
        );

        configureArtplayerStatics(Artplayer);
        Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

        artPlayerRef.current = new Artplayer({
          container: artRef.current,
          url: videoUrl,
          ...createArtPlayerConfig({
            isLive: false,
            setting: true,
            playbackRate: true,
            fastForward: true,
          }),
          customType: {
            m3u8: function (video: HTMLVideoElement, url: string) {
              if (!Hls) {
                console.error('HLS.js 未加载');
                return;
              }

              const managedVideo = getManagedVideo(video);

              runManagedVideoCleanup(managedVideo);

              // 切集复用：loader 配置未变时跳过 HLS 销毁重建，直接切换源
              const currentBlockAd = blockAdEnabledRef.current;
              const existingHls = managedVideo.hls;
              const canReuseHls =
                !!existingHls && managedVideo.__icetvBlockAd === currentBlockAd;

              let hls: any;
              if (canReuseHls) {
                hls = existingHls;
                // 移除旧的 HLS 事件监听器，后续重新绑定新的
                const oldHandlers = managedVideo.__icetvHlsHandlers;
                if (oldHandlers) {
                  hls.off(Hls.Events.ERROR, oldHandlers.onError);
                  hls.off(Hls.Events.FRAG_LOADED, oldHandlers.onFragLoaded);
                }
              } else {
                destroyManagedHls(managedVideo);
                hls = new Hls({
                  ...createHlsConfig({
                    maxBufferLength: 30,
                    maxMaxBufferLength: 120,
                    backBufferLength: 30,
                  }),
                  // VOD 场景快速失败：避免 hls.js 默认的多轮长重试吃掉
                  // 外层 15s 换源超时预算，换源失败要能迅速走自动降级
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
                    ? (AdBlockingHlsLoader as unknown as typeof Hls.DefaultConfig.loader)
                    : Hls.DefaultConfig.loader,
                });
              }
              managedVideo.__icetvBlockAd = currentBlockAd;

              // 根据 admin 路由 + 会话期失败记忆决定是否直连；
              // 若 browser 模式起播失败，会在当前源内自动切到 server 再试一次。
              const sourceKey = detailRef.current?.source || '';
              const buildTargetUrl = (
                rawUrl: string,
                useServerProxy: boolean,
              ) => {
                const params = new URLSearchParams({ url: rawUrl });
                if (useServerProxy) {
                  params.set('forceServer', 'true');
                } else {
                  params.set('allowCORS', 'true');
                }
                if (sourceKey) {
                  params.set('icetv-source', sourceKey);
                }
                appendPlaybackRequestContext(params);
                return `/api/proxy/m3u8?${params.toString()}`;
              };
              let currentUseServerProxy = isServerProxy(sourceKey);
              let targetUrl = buildTargetUrl(url, currentUseServerProxy);
              managedVideo.__icetvUsingServerProxy = currentUseServerProxy;

              setRealtimeLoadSpeed('测速中...');

              // 收集首分片测速数据，回填给 SourcesTab
              let firstFragSpeed = '';
              let firstFragPing = 0;
              let videoInfoReported = false;
              let fragLoadStart = performance.now();

              let speedFallbackTimer: ReturnType<typeof setTimeout> | null =
                null;
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
                // 同源重载/代理回退会重新装填 manifest，先记住当前位置，避免恢复后从头开始。
                resumeTimeRef.current = resumeTime;
                resumeModeRef.current = 'forced';
                loadingSessionRef.current.pendingInitialResumeTarget = null;
              };

              const switchToServerProxy = (reason: string) => {
                if (currentUseServerProxy) {
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
                    rememberSourceServerProxy(sourceKey);
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

              const tryRecoverPlaybackStall = (
                reason: 'waiting' | 'stalled',
              ) => {
                if (video.paused || video.ended) {
                  return;
                }

                const currentTime = video.currentTime || 0;
                const ranges = getBufferedRanges();
                const activeRange = ranges.find(
                  ([start, end]) => currentTime >= start && currentTime < end,
                );
                const nextRange = ranges.find(([start]) => start > currentTime);
                const bufferedAhead = activeRange
                  ? activeRange[1] - currentTime
                  : 0;
                const gapToNext = nextRange
                  ? nextRange[0] - (activeRange ? activeRange[1] : currentTime)
                  : null;

                console.warn('检测到点播播放卡顿，尝试恢复', {
                  reason,
                  currentTime: Number(currentTime.toFixed(2)),
                  readyState: video.readyState,
                  networkState: video.networkState,
                  bufferedAhead: Number(bufferedAhead.toFixed(2)),
                  gapToNext:
                    gapToNext === null ? null : Number(gapToNext.toFixed(2)),
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

                if (
                  nextRange &&
                  gapToNext !== null &&
                  gapToNext > 0 &&
                  gapToNext <= 1
                ) {
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

              let videoRuntimeCleaned = false;
              const cleanupVideoRuntime = () => {
                if (videoRuntimeCleaned) return;
                videoRuntimeCleaned = true;
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

              // 首帧解码后收集分辨率，与首分片速度合并回填
              const tryReportVideoInfo = () => {
                if (videoInfoReported || !firstFragSpeed) return;
                const w = video.videoWidth;
                if (!w || w <= 0) return;
                videoInfoReported = true;
                const quality =
                  w >= 3840
                    ? '4K'
                    : w >= 2560
                      ? '2K'
                      : w >= 1920
                        ? '1080p'
                        : w >= 1280
                          ? '720p'
                          : w >= 854
                            ? '480p'
                            : 'SD';
                onCurrentSourceVideoInfo?.(
                  {
                    quality,
                    loadSpeed: firstFragSpeed,
                    pingTime: firstFragPing,
                  },
                  playbackInfoContext,
                );
              };

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
                  phase: currentUseServerProxy
                    ? 'server-proxy'
                    : 'browser-direct',
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
                    switchToServerProxy(errorReason)
                  ) {
                    return;
                  }

                  markCurrentSourceFailure(
                    sourceFailureReason,
                    errorReason,
                    errorStatus,
                  );

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
                    setError('播放源加载失败，请尝试切换其他源站');
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
                  markCurrentSourceFailure(
                    sourceFailureReason,
                    errorReason,
                    errorStatus,
                  );
                  setRealtimeLoadSpeed('当前源加载慢，尝试恢复...');
                }
              };
              const onHlsFragLoaded = function (_: unknown, data: any) {
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
                  // 收集首分片速度用于回填 SourcesTab
                  if (!firstFragSpeed) {
                    firstFragSpeed = speedStr;
                    firstFragPing = Math.round(
                      performance.now() - fragLoadStart,
                    );
                    tryReportVideoInfo();
                  }
                } else if (loadedBytes > 0) {
                  setRealtimeLoadSpeed('0 KB/s');
                }
              };

              hls.on(Hls.Events.ERROR, onHlsError);
              hls.on(Hls.Events.FRAG_LOADED, onHlsFragLoaded);
              // 根据网络带宽智能选择起播码率：宽带直接最高 / 次高等级，首帧即清晰
              const onManifestParsed = (
                _evt: unknown,
                data: { levels?: unknown[] },
              ) => {
                const levelCount = Array.isArray(data?.levels)
                  ? data.levels.length
                  : 0;
                const picked = pickStartLevelFromStrategy(
                  HLS_START_LEVEL_STRATEGY,
                  levelCount,
                );
                if (picked !== undefined) {
                  hls.startLevel = picked;
                  hls.nextLevel = picked;
                }
              };
              hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
              // 保存处理器引用，复用时移除
              managedVideo.__icetvHlsHandlers = {
                onError: onHlsError,
                onFragLoaded: onHlsFragLoaded,
              };

              video.addEventListener('loadeddata', tryReportVideoInfo);

              hls.loadSource(targetUrl);
              if (!canReuseHls) {
                hls.attachMedia(video);
              }
              managedVideo.hls = hls;
              ensureVideoSource(video, targetUrl);
            },
          },
          settings: [
            {
              html: '去广告',
              icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
              tooltip: blockAdEnabled ? '已开启' : '已关闭',
              onClick() {
                const newVal = !blockAdEnabled;
                try {
                  localStorage.setItem('enable_blockad', String(newVal));
                  if (artPlayerRef.current) {
                    resumeTimeRef.current = artPlayerRef.current.currentTime;
                    resumeModeRef.current = 'forced';
                    const managedVideo = artPlayerRef.current.video;
                    runManagedVideoCleanup(managedVideo);
                    destroyManagedHls(managedVideo);
                    artPlayerRef.current.destroy();
                    artPlayerRef.current = null;
                  }
                  setBlockAdEnabled(newVal);
                } catch (_) {
                  // ignore
                }
                return newVal ? '当前开启' : '当前关闭';
              },
            },
            {
              name: '跳过片头片尾',
              html: '跳过片头片尾',
              switch: skipConfigRef.current.enable,
              onSwitch: function (item: { switch?: boolean }) {
                const newConfig = {
                  ...skipConfigRef.current,
                  enable: !item.switch,
                };
                handleSkipConfigChange(newConfig);
                return !item.switch;
              },
            },
            {
              html: '删除跳过配置',
              onClick: function () {
                handleSkipConfigChange({
                  enable: false,
                  intro_time: 0,
                  outro_time: 0,
                });
                return '';
              },
            },
            {
              name: '设置片头',
              html: '设置片头',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0
                  ? '设置片头时间'
                  : `${formatTime(skipConfigRef.current.intro_time)}`,
              onClick: function () {
                const currentTime = artPlayerRef.current?.currentTime || 0;
                if (currentTime > 0) {
                  const newConfig = {
                    ...skipConfigRef.current,
                    intro_time: currentTime,
                  };
                  handleSkipConfigChange(newConfig);
                  return `${formatTime(currentTime)}`;
                }
              },
            },
            {
              name: '设置片尾',
              html: '设置片尾',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.outro_time >= 0
                  ? '设置片尾时间'
                  : `-${formatTime(-skipConfigRef.current.outro_time)}`,
              onClick: function () {
                const outroTime =
                  -(
                    (artPlayerRef.current?.duration ?? 0) -
                    (artPlayerRef.current?.currentTime ?? 0)
                  ) || 0;
                if (outroTime < 0) {
                  const newConfig = {
                    ...skipConfigRef.current,
                    outro_time: outroTime,
                  };
                  handleSkipConfigChange(newConfig);
                  return `-${formatTime(-outroTime)}`;
                }
              },
            },
          ],
          controls: [
            {
              position: 'left',
              index: 13,
              html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
              tooltip: '播放下一集',
              click: function () {
                handleNextEpisode();
              },
            },
          ],
        });

        const player = artPlayerRef.current;
        if (!player) {
          return;
        }

        // 共用切换集数逻辑：幂等地触发自动切下一集，
        // 让 ended / 跳片尾 / 临近片尾兜底 三条通道复用同一个出口，避免重复点
        const tryAutoAdvanceEpisode = (): boolean => {
          if (!autoAdvanceArmedRef.current) return false;
          if (autoAdvancedRef.current) return false;
          const d = detailRef.current;
          const idx = currentEpisodeIndexRef.current;
          if (!d?.episodes || idx >= d.episodes.length - 1) return false;
          autoAdvancedRef.current = true;
          handleNextEpisode();
          return true;
        };

        const updateStableCurrentTime = (time: number) => {
          // 切到目标集但尚未真正起播前，忽略旧播放器残留的时间回写。
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
          } catch (err) {
            console.warn('重置目标集起播位置失败:', err);
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
              player.notice.show = notice;
            } catch (err) {
              console.warn('显示换源成功提示失败:', err);
            }
          }, 50);
        };

        const notifyPlayerPlaybackStarted = () => {
          const activeVideo = player.video as HTMLVideoElement | undefined;
          const activeSourceKey = detailRef.current?.source || '';
          if (activeVideo && activeSourceKey) {
            const activeManagedVideo = getManagedVideo(activeVideo);
            if (activeManagedVideo.__icetvUsingServerProxy === false) {
              clearSourceProxyOverride(activeSourceKey);
            }
          }
          showSourceSwitchSuccessNotice();
          onPlaybackStarted?.();
          playbackRequestModeRef.current = 'initial';
        };

        const finishInitialLoading = () => {
          if (!markPlayerLoadingSessionStarted(loadingSessionRef.current)) {
            return;
          }

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
            .catch((err) => {
              initialPlaybackRequestInFlight = false;
              if (
                err instanceof DOMException &&
                err.name === 'NotAllowedError' &&
                shouldDismissLoadingFromReadyFrame(video)
              ) {
                finishInitialLoading();
                getManagedVideo(video).hls?.stopLoad?.();
                return;
              }
              console.warn('自动起播失败:', err);
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
          } catch (err) {
            console.warn('重试恢复播放进度失败:', err);
          }

          return false;
        };

        const finishLoadingFromPlaybackStarted = () => {
          finishInitialLoading();
        };

        const ensureInitialPlaybackPosition = () => {
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
            } catch (err) {
              console.warn('恢复播放进度失败:', err);
            }
          } else if (resetPlaybackToStartIfNeeded()) {
            appliedResumeTarget = 0;
            intendedResumeTarget = 0;
          }

          loadingSessionRef.current.pendingInitialResumeTarget =
            appliedResumeTarget;
          resumeTimeRef.current = null;
          resumeModeRef.current = null;
          // 优先用本次写入的恢复目标作为 stableCurrentTime 兜底。
          // HLS 起播 canplay 可能在 seek 真正生效前触发，此时直接读 player.currentTime
          // 仍是 0；不预留 T 的话，后续手动换源会丢掉这段历史进度。
          const fallbackTime =
            intendedResumeTarget !== null
              ? intendedResumeTarget
              : player.currentTime || 0;
          updateStableCurrentTime(fallbackTime);

          return appliedResumeTarget;
        };

        const finishInitialLoadingIfMediaReady = () => {
          if (cancelled) {
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

        // --- 播放器事件 ---

        player.on('ready', () => {
          setError(null);
          if (player.playing) {
            requestWakeLock();
          }
        });

        player.on('play', () => {
          const activeVideo = player.video as HTMLVideoElement | undefined;
          if (activeVideo) {
            getManagedVideo(activeVideo).hls?.startLoad?.();
          }
          requestWakeLock();
          setIsPlaying(true);
        });

        // 备用：playing 事件表示视频已真正开始渲染帧，
        // 某些 HLS 流 canplay 可能不触发，因此这里也要兜底套用初始恢复进度。
        player.on('video:playing', () => {
          ensureInitialPlaybackPosition();
          finishLoadingFromPlaybackStarted();
          if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
            retryPendingResumePosition();
          }
        });

        player.on('pause', () => {
          releaseWakeLock();
          saveCurrentPlayProgress();
          setIsPlaying(false);
        });

        player.on('video:ended', () => {
          releaseWakeLock();
          setIsPlaying(false);
          // 自动播放下一集（共用切换集数逻辑）
          tryAutoAdvanceEpisode();
        });

        if (player.playing) {
          requestWakeLock();
        }

        player.on('video:volumechange', () => {
          lastVolumeRef.current = player.volume;
        });

        player.on('video:ratechange', () => {
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
            player.notice.show = '';
          }, 0);

          finishInitialLoadingIfMediaReady();
        });

        player.on('video:loadeddata', finishInitialLoadingIfMediaReady);
        player.on('video:progress', finishInitialLoadingIfMediaReady);

        // 跳过片头片尾
        player.on('video:timeupdate', () => {
          updateStableCurrentTime(player.currentTime || 0);

          if (loadingSessionRef.current.pendingInitialResumeTarget !== null) {
            completePendingResumeIfReady();
          }

          if (shouldDismissLoadingFromCanPlay(player.video)) {
            finishLoadingFromPlaybackStarted();
          }

          // HLS 兜底：部分源不会在播放结束时派发 ended 事件，
          // 用接近 duration 作为兜底信号触发自动切下一集（共用切换集数逻辑）
          {
            const dur = player.duration || 0;
            const cur = player.currentTime || 0;
            if (
              dur > 0 &&
              cur > 0 &&
              dur - cur <= 0.4 &&
              loadingSessionRef.current.pendingInitialResumeTarget === null
            ) {
              if (tryAutoAdvanceEpisode()) return;
            }
          }

          if (allowAutoResumeRef.current) {
            if (!isWithinAutoResumeWindow(player.currentTime || 0)) {
              // 超过起播窗口后关闭自动恢复，避免后续网络抖动再次触发 canplay 时跳回旧进度。
              allowAutoResumeRef.current = false;
              if (resumeModeRef.current === 'history') {
                resumeTimeRef.current = null;
                resumeModeRef.current = null;
              }
            }
          }

          if (!skipConfigRef.current.enable) return;

          const currentTime = player.currentTime || 0;
          const duration = player.duration || 0;
          const now = Date.now();

          if (now - lastSkipCheckRef.current < 1500) return;
          lastSkipCheckRef.current = now;

          if (
            skipConfigRef.current.intro_time > 0 &&
            currentTime < skipConfigRef.current.intro_time
          ) {
            player.currentTime = skipConfigRef.current.intro_time;
            player.notice.show = `已跳过片头 (${formatTime(skipConfigRef.current.intro_time)})`;
          }

          if (
            skipConfigRef.current.outro_time < 0 &&
            duration > 0 &&
            currentTime > player.duration + skipConfigRef.current.outro_time
          ) {
            // 共用 helper：内部已做幂等保护与"最后一集则不切"判断
            if (!tryAutoAdvanceEpisode()) {
              player.pause();
            }
            player.notice.show = `已跳过片尾 (${formatTime(skipConfigRef.current.outro_time)})`;
          }
        });

        player.on('error', (err: Error) => {
          console.error('播放器错误:', err);
          if (player.currentTime > 0) return;
          const activeVideo = player.video as HTMLVideoElement | undefined;
          const activeManagedVideo = activeVideo
            ? getManagedVideo(activeVideo)
            : null;
          if (
            activeManagedVideo?.__icetvSwitchToServerProxy?.(
              err.message || 'player-error',
            )
          ) {
            return;
          }
        });

        // 定时保存进度
        player.on('video:timeupdate', () => {
          const now = Date.now();
          if (now - lastSaveTimeRef.current > 5000) {
            saveCurrentPlayProgress();
          }
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
          ensureVideoSource(player.video as HTMLVideoElement, videoUrl);
        }

        window.setTimeout(finishInitialLoadingIfMediaReady, 0);
        window.setTimeout(finishInitialLoadingIfMediaReady, 500);
      } catch (err) {
        console.error('创建播放器失败:', err);
        setError('播放器初始化失败');
      }
    };

    void initPlayer();

    return () => {
      cancelled = true;
    };
  }, [
    videoUrl,
    loading,
    blockAdEnabled,
    playbackRequestModeRef,
    onPlaybackStarted,
    onSourceProxyFallbackStarted,
  ]);
}
