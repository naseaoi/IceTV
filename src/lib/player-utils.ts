/**
 * 播放器公共工具模块
 * 提取 useArtPlayer / useLivePlayer 中共用的函数和配置
 */

// ---------------------------------------------------------------------------
// 视频源管理
// ---------------------------------------------------------------------------

/** 确保 <video> 下有正确的 <source> 子元素，并解除 remotePlayback 限制 */
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

// ---------------------------------------------------------------------------
// HLS 初始带宽自适应估算
// ---------------------------------------------------------------------------

type NetworkInfoLike = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
};

/** 根据网络环境推算初始带宽估算值（bps），避免 HLS.js 从最低码率起播 */
function resolveInitialBandwidthEstimate(): number {
  // 2 Mbps，国内宽带的保守起步值
  const DEFAULT_BPS = 2_000_000;
  if (typeof navigator === 'undefined') return DEFAULT_BPS;

  const conn = (navigator as Navigator & { connection?: NetworkInfoLike })
    .connection;
  if (!conn) return DEFAULT_BPS;
  if (conn.saveData) return 500_000;

  if (typeof conn.downlink === 'number' && conn.downlink > 0) {
    // downlink 是 Mbps，转 bps 后取 70% 避免高估
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

// ---------------------------------------------------------------------------
// HLS 缓冲策略自适应（桌面 vs 移动 / 低内存设备）
// ---------------------------------------------------------------------------

/**
 * 判定是否应当使用"轻量缓冲"策略。
 * 移动端与低内存设备下，过大的前/后向缓冲会导致 MSE OOM、卡顿、应用被系统回收。
 */
function shouldUseLightBuffer(): boolean {
  if (typeof navigator === 'undefined') return false;

  // deviceMemory 是 Chrome 私有字段，单位 GB；可能为 undefined
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  if (
    typeof deviceMemory === 'number' &&
    deviceMemory > 0 &&
    deviceMemory <= 4
  ) {
    return true;
  }

  // 经典移动 UA 判断（桌面端 userAgent 不会匹配下列关键字）
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua)) return true;

  return false;
}

/** 返回一组 maxBufferLength / maxMaxBufferLength / backBufferLength / maxBufferSize 默认值 */
function resolveBufferDefaults() {
  if (shouldUseLightBuffer()) {
    return {
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 30,
      maxBufferSize: 30 * 1000 * 1000, // 30 MB
    };
  }
  return {
    maxBufferLength: 90,
    maxMaxBufferLength: 120,
    backBufferLength: 90,
    maxBufferSize: 60 * 1000 * 1000, // 60 MB
  };
}

// ---------------------------------------------------------------------------
// HLS 起播码率策略
// ---------------------------------------------------------------------------

/**
 * 计算 HLS 起播码率等级。
 * - hls.js 的 startLevel: -1 = 自动（通常偏保守，首片走低码率再逐步升）
 * - 根据网络估算带宽直接选择 master playlist 中一个合理等级，首帧即清晰
 *
 * 返回值：
 * - undefined：沿用 hls.js 默认（-1 auto）
 * - 数值：具体 variant index（等待 levels 解析后由 MANIFEST_PARSED 事件消费）
 */
function resolveStartLevel(): number | undefined {
  if (typeof navigator === 'undefined') return undefined;

  const conn = (navigator as Navigator & { connection?: NetworkInfoLike })
    .connection;

  // 省流量 / 慢网：交给 auto，避免起播就拉大码率导致卡顿
  if (!conn) return undefined;
  if (conn.saveData) return undefined;

  const slowTypes = new Set(['slow-2g', '2g', '3g']);
  if (conn.effectiveType && slowTypes.has(conn.effectiveType)) return undefined;

  // downlink >= 10 Mbps：倾向最高码率；5~10 Mbps：倾向次高；其它交给 auto
  // 注意：真正选择发生在 MANIFEST_PARSED 事件里（此时才知道 levels 数量），
  //      这里只返回一个策略指示（用 Number.MAX_SAFE_INTEGER 代表"最高可用等级"）
  if (typeof conn.downlink === 'number') {
    if (conn.downlink >= 10) return Number.MAX_SAFE_INTEGER;
    if (conn.downlink >= 5) return Number.MAX_SAFE_INTEGER - 1;
  }
  return undefined;
}

/**
 * 将 resolveStartLevel 返回的策略标记映射到真实 level index。
 * 调用时机：hls.js MANIFEST_PARSED 事件内（此时 hls.levels 已就绪）。
 */
export function pickStartLevelFromStrategy(
  marker: number | undefined,
  levelCount: number,
): number | undefined {
  if (marker === undefined || levelCount <= 0) return undefined;
  // 最高可用等级
  if (marker === Number.MAX_SAFE_INTEGER) return levelCount - 1;
  // 次高
  if (marker === Number.MAX_SAFE_INTEGER - 1) {
    return Math.max(0, levelCount - 2);
  }
  // 其它直接当作 index 使用（夹到合法范围）
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

/** 创建 HLS.js 默认配置，可通过 overrides 覆盖 */
export function createHlsConfig(overrides?: HlsConfigOverrides) {
  const bufferDefaults = resolveBufferDefaults();
  return {
    debug: false,
    enableWorker: true,
    // 默认按点播场景取更稳妥的缓冲策略，直播再单独覆盖。
    lowLatencyMode: false,
    // 缓冲默认按设备分档：桌面 90/120，移动/低内存 30/60，避免 MSE OOM
    maxBufferLength: bufferDefaults.maxBufferLength,
    maxMaxBufferLength: bufferDefaults.maxMaxBufferLength,
    backBufferLength: bufferDefaults.backBufferLength,
    maxBufferSize: bufferDefaults.maxBufferSize,
    maxBufferHole: 0.5,
    nudgeOffset: 0.1,
    nudgeMaxRetry: 8,
    // 允许更早拉起首个分片，缩短首帧等待。
    startFragPrefetch: true,
    progressive: true,
    testBandwidth: true,
    // 根据网络环境设定初始带宽估算，避免从最低码率起播
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
