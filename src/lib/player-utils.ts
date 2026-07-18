import { resolveHlsBufferDefaults } from '@/lib/hls-buffer-policy';

// ---------------------------------------------------------------------------
// 视频源管理
// ---------------------------------------------------------------------------

export function ensureVideoSource(video: HTMLVideoElement | null, url: string) {
  if (!video || !url) return;
  const sources = Array.from(video.getElementsByTagName('source'));
  const existed = sources.some((s) => s.src === url);
  if (!existed) {
    sources.forEach((s) => s.remove());
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
  fastForward?: boolean;
  autoPlayback?: boolean;
  moreVideoAttr?: Record<string, unknown>;
}

const LOADING_ICON_SVG =
  '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">';

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
    theme: '#3b82f6',
    lang: 'zh-cn' as const,
    hotkey: false,
    autoOrientation: true,
    lock: true,
    moreVideoAttr: {
      crossOrigin: 'anonymous',
      ...extraVideoAttr,
    },
    icons: { loading: LOADING_ICON_SVG },
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
// HLS 错误统一处理
// ---------------------------------------------------------------------------

/** HLS 致命错误标准处理：网络错误重载、媒体错误恢复、其他销毁 */
export function handleHlsFatalError(
  hls: {
    startLoad: () => void;
    recoverMediaError: () => void;
    destroy: () => void;
  },
  errorType: string,
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string },
) {
  switch (errorType) {
    case ErrorTypes.NETWORK_ERROR:
      hls.startLoad();
      break;
    case ErrorTypes.MEDIA_ERROR:
      hls.recoverMediaError();
      break;
    default:
      hls.destroy();
      break;
  }
}
