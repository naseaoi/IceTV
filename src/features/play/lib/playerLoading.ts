// 准备阶段、媒体加载与页面判定共用前台时钟，后台挂起不消耗 W/T。
const VOD_FOREGROUND_GRACE_MS = 1000;
let clockListening = false;
let hiddenAt: number | null = null;
let excludedMs = 0;
let graceStartedAt: number | null = null;

export function getVodStartupNow(): number {
  if (!clockListening && typeof document !== 'undefined') {
    clockListening = true;
    hiddenAt = document.hidden ? performance.now() : null;
    document.addEventListener('visibilitychange', () => {
      const now = performance.now();
      if (document.hidden) {
        if (hiddenAt !== null) return;
        if (graceStartedAt !== null) {
          excludedMs += Math.min(now - graceStartedAt, VOD_FOREGROUND_GRACE_MS);
          graceStartedAt = null;
        }
        hiddenAt = now;
      } else if (hiddenAt !== null) {
        excludedMs += now - hiddenAt;
        hiddenAt = null;
        graceStartedAt = now;
      }
    });
  }
  const now = hiddenAt ?? performance.now();
  const graceMs =
    graceStartedAt === null
      ? 0
      : Math.min(now - graceStartedAt, VOD_FOREGROUND_GRACE_MS);
  return now - excludedMs - graceMs;
}

export interface VodStartupProgress {
  sourceKey: string;
  startedAt: number;
  lastProgressAt: number;
  sampleProgress?: () => void;
}

const vodStartupProgress = new WeakMap<HTMLVideoElement, VodStartupProgress>();

export function beginVodStartupProgress(
  video: HTMLVideoElement,
  sourceKey: string,
  sampleProgress?: () => void,
): VodStartupProgress {
  const now = getVodStartupNow();
  const progress = {
    sourceKey,
    startedAt: now,
    lastProgressAt: now,
    sampleProgress,
  };
  vodStartupProgress.set(video, progress);
  return progress;
}

export function getVodStartupProgress(
  video: HTMLVideoElement,
): VodStartupProgress | null {
  const progress = vodStartupProgress.get(video);
  progress?.sampleProgress?.();
  return progress ?? null;
}

export function clearVodStartupProgress(video: HTMLVideoElement): void {
  vodStartupProgress.delete(video);
}

type StartupStateDescriber = () => Record<string, unknown>;
type StartupStateSection = 'session' | 'route';

const startupStateDescribers = new WeakMap<
  HTMLVideoElement,
  Partial<Record<StartupStateSection, StartupStateDescriber>>
>();

// 播放器会话与 hls 线路各自登记快照入口，起播超时时与媒体、hls 状态一起输出，用于定位卡住的环节
export function registerStartupStateDescriber(
  video: HTMLVideoElement,
  section: StartupStateSection,
  describe: StartupStateDescriber,
): void {
  startupStateDescribers.set(video, {
    ...startupStateDescribers.get(video),
    [section]: describe,
  });
}

const roundTime = (value: number) =>
  Number.isFinite(value) ? Number(value.toFixed(2)) : value;

export function describeVodStartupState(
  video: HTMLVideoElement | null | undefined,
): Record<string, unknown> {
  if (!video) return { video: null };
  const buffered: Array<[number, number]> = [];
  for (let i = 0; i < video.buffered.length; i += 1) {
    buffered.push([
      roundTime(video.buffered.start(i)),
      roundTime(video.buffered.end(i)),
    ]);
  }
  const hls = (video as HTMLVideoElement & { hls?: any }).hls;
  const describers = startupStateDescribers.get(video) ?? {};
  const describe = (section: StartupStateSection) => {
    try {
      return describers[section]?.() ?? null;
    } catch (error) {
      return { error: String(error) };
    }
  };
  return {
    video: {
      currentTime: roundTime(video.currentTime),
      duration: roundTime(video.duration),
      paused: video.paused,
      seeking: video.seeking,
      ended: video.ended,
      readyState: video.readyState,
      networkState: video.networkState,
      videoWidth: video.videoWidth,
      buffered,
      errorCode: video.error?.code ?? null,
    },
    hls: hls
      ? {
          loadingEnabled: hls.loadingEnabled,
          startPosition: hls.startPosition,
          configStartPosition: hls.config?.startPosition,
          levels: hls.levels?.length ?? 0,
          currentLevel: hls.currentLevel,
          loadLevel: hls.loadLevel,
          mediaAttached: hls.media === video,
          inFlight: Object.values<{
            state?: string;
            frag?: { sn?: unknown; start?: number; duration?: number };
          } | null>(hls.inFlightFragments ?? {}).map((entry) => ({
            state: entry?.state,
            sn: entry?.frag?.sn,
            start: roundTime(entry?.frag?.start ?? NaN),
            duration: roundTime(entry?.frag?.duration ?? NaN),
          })),
        }
      : null,
    session: describe('session'),
    route: describe('route'),
  };
}

export interface PlayerLoadingSessionState {
  pendingInitialResumeTarget: number | null;
  playbackStartNotified: boolean;
}

/**
 * canplay 只能说明媒体已具备继续播放的能力，
 * 但不代表用户已经看到首帧，因此仍需确认视频处于实际播放态。
 */
export function shouldDismissLoadingFromCanPlay(
  video: Pick<HTMLVideoElement, 'paused' | 'ended'> | null | undefined,
): boolean {
  if (!video) {
    return false;
  }

  return !video.paused && !video.ended;
}

interface ReadyFrameVideo {
  readyState: number;
  videoWidth: number;
  currentTime: number;
  ended: boolean;
  buffered: {
    length: number;
    start(index: number): number;
    end(index: number): number;
  };
}

export function shouldDismissLoadingFromReadyFrame(
  video: ReadyFrameVideo | null | undefined,
): boolean {
  if (!video || video.ended) {
    return false;
  }

  if (video.readyState < 2 || video.videoWidth <= 0) {
    return false;
  }

  const currentTime = Number.isFinite(video.currentTime)
    ? video.currentTime
    : 0;
  for (let i = 0; i < video.buffered.length; i += 1) {
    const start = video.buffered.start(i);
    const end = video.buffered.end(i);
    if (start <= currentTime + 0.5 && end > currentTime) {
      return true;
    }
  }

  return false;
}

/**
 * 切集或换源开始新一轮加载时，必须重置本轮的 loading 会话状态。
 */
export function resetPlayerLoadingSessionState(
  state: PlayerLoadingSessionState,
): void {
  state.pendingInitialResumeTarget = null;
  state.playbackStartNotified = false;
}

/**
 * loading 关闭只允许执行一次；同一轮后续重复事件应直接忽略。
 */
export function markPlayerLoadingSessionStarted(
  state: PlayerLoadingSessionState,
): boolean {
  if (state.playbackStartNotified) {
    return false;
  }

  state.playbackStartNotified = true;
  return true;
}

/**
 * 恢复进度时允许 1 秒误差，避免 HLS 分片边界或浏览器取整造成永远等不到完全相等。
 */
export function hasReachedResumeTarget(
  currentTime: number,
  targetTime: number | null | undefined,
): boolean {
  if (!Number.isFinite(currentTime) || !Number.isFinite(targetTime)) {
    return false;
  }

  if ((targetTime as number) <= 0) {
    return true;
  }

  return currentTime >= (targetTime as number) - 1;
}
