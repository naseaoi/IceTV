import { SPINNER_MARKUP } from '@/components/Spinner';
import { resolveHlsBufferDefaults } from '@/lib/hls-buffer-policy';

// ---------------------------------------------------------------------------
// 视频源管理
// ---------------------------------------------------------------------------

// url 作为远程播放（AirPlay）的备选源追加在末尾。hls.js 在 ManagedMediaSource 下（iPadOS / Safari 17+）
// 用 blob: 的 <source> 挂载媒体源，必须保留且排在最前；删掉它 Safari 会按顺序选中 m3u8 原生播放，
// 绕过 hls.js 的清单处理（客户端去广告、线路回落等）。
export function ensureVideoSource(video: HTMLVideoElement | null, url: string) {
  if (!video || !url) return;
  let hasTarget = false;
  for (const source of Array.from(video.getElementsByTagName('source'))) {
    if (source.src.startsWith('blob:')) continue;
    if (source.src === url && !hasTarget) {
      hasTarget = true;
      continue;
    }
    source.remove();
  }
  if (!hasTarget) {
    const sourceEl = document.createElement('source');
    sourceEl.src = url;
    video.appendChild(sourceEl);
  }
  video.disableRemotePlayback = false;
  if (video.hasAttribute('disableRemotePlayback')) {
    video.removeAttribute('disableRemotePlayback');
  }
}

// ---------------------------------------------------------------------------
// 时间/速度格式化
// ---------------------------------------------------------------------------

export function formatTime(seconds: number): string {
  if (seconds === 0) return '00:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (hours === 0) {
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function formatBytesPerSecond(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 KB/s';
  const kb = bytesPerSecond / 1024;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB/s`;
  return `${kb.toFixed(1)} KB/s`;
}

export function showTimedArtNotice(
  player: {
    constructor?: Function & { NOTICE_TIME?: number };
    notice?: { show: string };
  } | null,
  message: string,
  durationMs = 2000,
): void {
  if (!player?.notice) return;

  const constructorRef = player.constructor;
  const previousDuration = constructorRef?.NOTICE_TIME;
  if (constructorRef && Number.isFinite(durationMs) && durationMs > 0) {
    constructorRef.NOTICE_TIME = Math.floor(durationMs);
  }

  player.notice.show = message;

  if (constructorRef && typeof previousDuration === 'number') {
    constructorRef.NOTICE_TIME = previousDuration;
  }
}

// ---------------------------------------------------------------------------
// HLS 初始带宽自适应估算
// ---------------------------------------------------------------------------

type NetworkInfoLike = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
};

function resolveInitialBandwidthEstimate(): number {
  const DEFAULT_BPS = 5_000_000;
  if (typeof navigator === 'undefined') return DEFAULT_BPS;

  const conn = (navigator as Navigator & { connection?: NetworkInfoLike })
    .connection;
  if (!conn) return DEFAULT_BPS;
  if (conn.saveData) return 500_000;

  if (typeof conn.downlink === 'number' && conn.downlink > 0) {
    return Math.max(500_000, Math.round(conn.downlink * 1_000_000 * 0.7));
  }

  switch (conn.effectiveType) {
    case 'slow-2g':
      return 100_000;
    case '2g':
      return 200_000;
    case '3g':
      return 800_000;
    default:
      return DEFAULT_BPS;
  }
}

function resolveBufferDefaults() {
  if (typeof navigator === 'undefined') {
    return resolveHlsBufferDefaults({});
  }

  const navigatorWithRuntimeInfo = navigator as Navigator & {
    connection?: NetworkInfoLike;
    deviceMemory?: number;
  };
  return resolveHlsBufferDefaults({
    saveData: navigatorWithRuntimeInfo.connection?.saveData,
    effectiveType: navigatorWithRuntimeInfo.connection?.effectiveType,
    deviceMemory: navigatorWithRuntimeInfo.deviceMemory,
    userAgent: navigator.userAgent || '',
  });
}

// ---------------------------------------------------------------------------
// HLS 起播码率策略
// ---------------------------------------------------------------------------

function resolveStartLevel(): number | undefined {
  if (typeof navigator === 'undefined') return undefined;

  const conn = (navigator as Navigator & { connection?: NetworkInfoLike })
    .connection;

  if (!conn) return undefined;
  if (conn.saveData) return undefined;

  const slowTypes = new Set(['slow-2g', '2g', '3g']);
  if (conn.effectiveType && slowTypes.has(conn.effectiveType)) return undefined;

  if (typeof conn.downlink === 'number') {
    if (conn.downlink >= 10) return Number.MAX_SAFE_INTEGER;
    if (conn.downlink >= 5) return Number.MAX_SAFE_INTEGER - 1;
  }
  return undefined;
}

export function pickStartLevelFromStrategy(
  marker: number | undefined,
  levelCount: number,
): number | undefined {
  if (marker === undefined || levelCount <= 0) return undefined;
  if (marker === Number.MAX_SAFE_INTEGER) return levelCount - 1;
  if (marker === Number.MAX_SAFE_INTEGER - 1) {
    return Math.max(0, levelCount - 2);
  }
  return Math.min(Math.max(0, marker), levelCount - 1);
}

export const HLS_START_LEVEL_STRATEGY = resolveStartLevel();

// ---------------------------------------------------------------------------
// HLS 配置工厂
// ---------------------------------------------------------------------------

export interface HlsConfigOverrides {
  debug?: boolean;
  enableWorker?: boolean;
  lowLatencyMode?: boolean;
  maxBufferLength?: number;
  maxMaxBufferLength?: number;
  backBufferLength?: number;
  maxBufferSize?: number;
  minBufferLength?: number;
  maxBufferHole?: number;
  nudgeOffset?: number;
  nudgeMaxRetry?: number;
  startFragPrefetch?: boolean;
  progressive?: boolean;
  testBandwidth?: boolean;
  preserveManualLevelOnError?: boolean;
  liveSyncDurationCount?: number;
  liveMaxLatencyDurationCount?: number;
  initialLiveManifestSize?: number;
  startPosition?: number;
  loader?: unknown;
}

export function createHlsConfig(overrides?: HlsConfigOverrides) {
  const bufferDefaults = resolveBufferDefaults();
  return {
    debug: false,
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: bufferDefaults.maxBufferLength,
    maxMaxBufferLength: bufferDefaults.maxMaxBufferLength,
    backBufferLength: bufferDefaults.backBufferLength,
    maxBufferSize: bufferDefaults.maxBufferSize,
    minBufferLength: 20,
    maxBufferHole: 0.5,
    nudgeOffset: 0.1,
    nudgeMaxRetry: 8,
    startFragPrefetch: true,
    progressive: true,
    testBandwidth: true,
    abrEwmaDefaultEstimate: resolveInitialBandwidthEstimate(),
    // 源站不使用插播；开启时挂载媒体会按 currentTime=0 判定偏离续播点而再次 startLoad，中止在途首片
    enableInterstitialPlayback: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Artplayer 配置工厂
// ---------------------------------------------------------------------------

export interface ArtPlayerConfigOverrides {
  isLive?: boolean;
  muted?: boolean;
  autoplay?: boolean;
  setting?: boolean;
  screenshot?: boolean;
  playbackRate?: boolean;
  aspectRatio?: boolean;
  fastForward?: boolean;
  autoPlayback?: boolean;
  moreVideoAttr?: Record<string, unknown>;
}

/**
 * 创建 Artplayer 基础配置，VOD / Live 场景通过 overrides 差异化。
 * 不包含 container / url，这两个必须在调用端传入。
 */
export function createArtPlayerConfig(overrides?: ArtPlayerConfigOverrides) {
  const { moreVideoAttr: extraVideoAttr, ...rest } = overrides || {};

  return {
    volume: 0.7,
    muted: false,
    autoplay: true,
    pip: true,
    autoSize: false,
    autoMini: false,
    screenshot: false,
    loop: false,
    flip: false,
    aspectRatio: false,
    fullscreen: true,
    fullscreenWeb: true,
    subtitleOffset: false,
    miniProgressBar: false,
    mutex: true,
    backdrop: false,
    playsInline: true,
    airplay: true,
    // brand-400：深色画面上比 brand-500 更易辨认
    theme: '#5fa8d8',
    lang: 'zh-cn' as const,
    hotkey: false,
    autoOrientation: true,
    lock: true,
    moreVideoAttr: {
      crossOrigin: 'anonymous',
      ...extraVideoAttr,
    },
    icons: { loading: SPINNER_MARKUP },
    // 以下为可覆盖的差异项
    isLive: false,
    setting: false,
    playbackRate: false,
    fastForward: false,
    autoPlayback: false,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Artplayer 静态属性预设
// ---------------------------------------------------------------------------

/** 统一设置 Artplayer 全局静态属性 */
export function configureArtplayerStatics(Artplayer: {
  USE_RAF: boolean;
  FULLSCREEN_WEB_IN_BODY: boolean;
  PLAYBACK_RATE?: number[];
}) {
  Artplayer.USE_RAF = false;
  Artplayer.FULLSCREEN_WEB_IN_BODY = true;
}

// ---------------------------------------------------------------------------
// Artplayer 销毁（点播与直播共用）
// ---------------------------------------------------------------------------

// FULLSCREEN_WEB_IN_BODY 下网页全屏会把播放器节点移到 body，destroy 只清空原容器，不先退出会留下盖住整页的黑层
export function destroyArtPlayer(player: {
  fullscreenWeb: boolean;
  destroy: () => void;
}) {
  try {
    if (player.fullscreenWeb) player.fullscreenWeb = false;
  } catch (err) {
    console.warn('退出网页全屏失败:', err);
  }
  player.destroy();
}

// ---------------------------------------------------------------------------
// HLS 致命错误恢复（点播与直播共用）
// ---------------------------------------------------------------------------

export const HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS: readonly number[] = [
  1_000, 2_000, 4_000,
];
export const HLS_FATAL_MEDIA_RECOVERY_LIMIT = 2;
// 恢复后要连续播放这么久才清零全部计数，否则“恢复一下又坏”的流会无限重试
export const HLS_FATAL_RECOVERY_RESET_PLAYBACK_SECONDS = 10;
// timeupdate 约 250ms 触发一次，相邻进度跨度超过它视为跳转（续播定位、拖动），不算连续播放
const HLS_FATAL_RECOVERY_MAX_PROGRESS_STEP_SECONDS = 2;

export type HlsFatalRecoveryResult =
  | 'recovering'
  | 'exhausted'
  | 'unrecoverable';

export type HlsFatalRecoveryTarget = {
  startLoad: () => void;
  recoverMediaError: () => void;
  swapAudioCodec?: () => void;
};

export type HlsFragmentRef =
  | { sn?: unknown; type?: unknown }
  | null
  | undefined;

export type HlsFatalRecoveryController = {
  recover: (
    target: HlsFatalRecoveryTarget,
    errorType: string,
    ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string },
    failedFragment?: HlsFragmentRef,
    minimumDelayMs?: number,
  ) => HlsFatalRecoveryResult;
  // 返回 true 表示这次加载算作网络已恢复，调用方的线路失败计数也按它清零
  handleFragmentLoaded: (fragment?: HlsFragmentRef) => boolean;
  handlePlaybackProgress: (currentTime: number) => void;
  recordNetworkFailure: (fragment?: HlsFragmentRef) => void;
  cancelPendingRetry: () => void;
  reset: () => void;
  dispose: () => void;
};

type HlsFragmentPosition = { type: unknown; sn: number };

// init 分片的 sn 是 'initSegment'，与媒体分片分不出先后，按没有位置处理
function resolveFragmentPosition(
  fragment: HlsFragmentRef,
): HlsFragmentPosition | null {
  const sn = fragment?.sn;
  if (typeof sn !== 'number' || !Number.isFinite(sn)) return null;
  return { type: fragment?.type, sn };
}

export function createHlsFatalRecoveryController(): HlsFatalRecoveryController {
  let networkAttempts = 0;
  let mediaAttempts = 0;
  let networkRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let playbackAnchor: number | null = null;
  let lastPlaybackTime = 0;
  let failedFragment: HlsFragmentPosition | null = null;
  let disposed = false;

  const clearNetworkRetryTimer = () => {
    if (networkRetryTimer === null) return;
    clearTimeout(networkRetryTimer);
    networkRetryTimer = null;
  };

  const reset = () => {
    clearNetworkRetryTimer();
    networkAttempts = 0;
    mediaAttempts = 0;
    playbackAnchor = null;
    failedFragment = null;
  };

  return {
    recover(target, errorType, ErrorTypes, fragment, minimumDelayMs = 0) {
      // 释放后到达的迟到错误既不恢复，也不能让调用方当成失败处理
      if (disposed) return 'recovering';

      if (errorType === ErrorTypes.NETWORK_ERROR) {
        // 清单或 level 失败不带分片，沿用已记下的失败位置
        failedFragment = resolveFragmentPosition(fragment) ?? failedFragment;
        if (networkRetryTimer !== null) return 'recovering';
        if (networkAttempts >= HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length) {
          return 'exhausted';
        }
        const delayMs = Math.max(
          HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS[networkAttempts],
          Number.isFinite(minimumDelayMs)
            ? Math.min(300_000, minimumDelayMs)
            : 0,
        );
        networkAttempts += 1;
        playbackAnchor = null;
        networkRetryTimer = setTimeout(() => {
          networkRetryTimer = null;
          if (!disposed) target.startLoad();
        }, delayMs);
        return 'recovering';
      }

      if (errorType === ErrorTypes.MEDIA_ERROR) {
        if (mediaAttempts >= HLS_FATAL_MEDIA_RECOVERY_LIMIT) {
          return 'exhausted';
        }
        mediaAttempts += 1;
        playbackAnchor = null;
        if (mediaAttempts > 1) {
          target.swapAudioCodec?.();
        }
        target.recoverMediaError();
        return 'recovering';
      }

      return 'unrecoverable';
    },
    // 媒体错误恢复后分片照常能加载，只清网络计数，避免媒体错误借此无限循环
    // 恢复拉流会先重下失败位置之前已部分缓冲的分片，它常直接命中浏览器缓存；只有同类型分片到达失败位置才算恢复，否则坏流每轮清零，永远凑不满上限
    handleFragmentLoaded(fragment) {
      if (failedFragment) {
        const loaded = resolveFragmentPosition(fragment);
        if (
          !loaded ||
          loaded.type !== failedFragment.type ||
          loaded.sn < failedFragment.sn
        ) {
          return false;
        }
        failedFragment = null;
      }
      networkAttempts = 0;
      return true;
    },
    handlePlaybackProgress(currentTime) {
      if (
        (networkAttempts === 0 && mediaAttempts === 0) ||
        !Number.isFinite(currentTime)
      ) {
        return;
      }
      const step = currentTime - lastPlaybackTime;
      lastPlaybackTime = currentTime;
      if (
        playbackAnchor === null ||
        step < 0 ||
        step > HLS_FATAL_RECOVERY_MAX_PROGRESS_STEP_SECONDS
      ) {
        playbackAnchor = currentTime;
        return;
      }
      if (
        currentTime - playbackAnchor >=
        HLS_FATAL_RECOVERY_RESET_PLAYBACK_SECONDS
      ) {
        networkAttempts = 0;
        mediaAttempts = 0;
        playbackAnchor = null;
        failedFragment = null;
      }
    },
    recordNetworkFailure(fragment) {
      failedFragment = resolveFragmentPosition(fragment) ?? failedFragment;
    },
    cancelPendingRetry: clearNetworkRetryTimer,
    reset,
    dispose() {
      disposed = true;
      reset();
    },
  };
}
