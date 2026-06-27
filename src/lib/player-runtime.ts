import type HlsType from 'hls.js';

type PlayerModules = {
  Artplayer: any;
  Hls: any;
};

type HlsLoaderInstance = {
  load: (...args: unknown[]) => void;
};

type HlsLoaderConstructor = new (config: unknown) => HlsLoaderInstance;

type LoaderContext = {
  type?: string;
  url?: string;
};

type LoaderCallbacks = {
  onSuccess?: (...args: unknown[]) => unknown;
};

type HoverControlsArtPlayer = {
  controls?: { show: boolean };
  setting?: { show: boolean };
  template?: { $player?: HTMLElement };
  on?: (event: string, callback: (...args: unknown[]) => void) => unknown;
  off?: (event: string, callback?: (...args: unknown[]) => void) => unknown;
  isDestroy?: boolean;
};

const PLAYER_HOVER_CONTROLS_IDLE_HIDE_MS = 2_000;

export type ManagedVideoElement = HTMLVideoElement & {
  hls?: HlsType | null;
  __icetvHlsCleanup?: (() => void) | null;
  /** 上次创建 HLS 实例时的去广告开关状态（用于判断切集时是否可复用） */
  __icetvBlockAd?: boolean;
  /** HLS 事件处理器引用，复用时先移除旧的再绑定新的 */
  __icetvHlsHandlers?: {
    onError: (...args: unknown[]) => void;
    onFragLoaded: (...args: unknown[]) => void;
  } | null;
  /** 当前会话内该 video 实际使用的流量路由，供起播成功后清理短期兜底记忆。 */
  __icetvUsingServerProxy?: boolean;
  /** browser 起播失败时，挂给外层事件复用的同源 server 回退入口。 */
  __icetvSwitchToServerProxy?: ((reason: string) => boolean) | null;
  /** 预期媒体请求中止截止时间 */
  __icetvExpectedAbortUntil?: number;
};

let playerModulesPromise: Promise<PlayerModules> | null = null;

/** 缓存播放器模块，避免切集/切台时重复触发动态导入链路。 */
export async function getPlayerModules(): Promise<PlayerModules> {
  if (playerModulesPromise) {
    return playerModulesPromise;
  }

  playerModulesPromise = Promise.all([
    import('artplayer'),
    import('hls.js'),
  ]).then(([{ default: Artplayer }, { default: Hls }]) => ({
    Artplayer,
    Hls,
  }));

  return playerModulesPromise;
}

/** 预热播放器模块：页面加载时调用，提前触发动态导入 */
export function preloadPlayerModules(): void {
  getPlayerModules();
}

/** 预取 m3u8 代理地址（与模块加载并行），填充服务端缓存 */
export function prefetchM3U8(proxyUrl: string): void {
  fetch(proxyUrl, { cache: 'no-store' }).catch(() => {});
}

export function getManagedVideo(video: HTMLVideoElement): ManagedVideoElement {
  return video as ManagedVideoElement;
}

/** 运行并移除挂在 video 上的清理逻辑，避免监听器和旧实例残留。 */
export function runManagedVideoCleanup(video?: HTMLVideoElement | null): void {
  const managedVideo = video as ManagedVideoElement | null | undefined;
  if (!managedVideo) return;

  markManagedVideoExpectedAbort(managedVideo);
  const cleanup = managedVideo.__icetvHlsCleanup;
  managedVideo.__icetvHlsCleanup = null;
  cleanup?.();
}

export function assignManagedVideoCleanup(
  video: HTMLVideoElement,
  cleanup: () => void,
): ManagedVideoElement {
  const managedVideo = getManagedVideo(video);
  managedVideo.__icetvHlsCleanup = cleanup;
  return managedVideo;
}

export function destroyManagedHls(video?: HTMLVideoElement | null): void {
  const managedVideo = video as ManagedVideoElement | null | undefined;
  if (!managedVideo?.hls) return;

  markManagedVideoExpectedAbort(managedVideo);
  managedVideo.hls.destroy();
  managedVideo.hls = null;
}

export function markManagedVideoExpectedAbort(
  video?: HTMLVideoElement | null,
  windowMs = 4_000,
): void {
  const managedVideo = video as ManagedVideoElement | null | undefined;
  if (!managedVideo) return;
  managedVideo.__icetvExpectedAbortUntil = Date.now() + windowMs;
}

export function isManagedVideoExpectedAbort(
  video?: HTMLVideoElement | null,
): boolean {
  const managedVideo = video as ManagedVideoElement | null | undefined;
  const until = managedVideo?.__icetvExpectedAbortUntil || 0;
  return until > Date.now();
}

function isElementHovered(element: HTMLElement): boolean {
  try {
    return element.matches(':hover');
  } catch {
    return false;
  }
}

export function bindPlayerHoverControls(artPlayer: unknown): () => void {
  const art = artPlayer as HoverControlsArtPlayer;
  const player = art.template?.$player;
  if (!player || !art.controls) return () => {};

  let disposed = false;
  let pointerInside = isElementHovered(player);
  let pointerIdle = false;
  let idleHideTimer: number | null = null;

  const clearIdleHideTimer = () => {
    if (!idleHideTimer) return;
    window.clearTimeout(idleHideTimer);
    idleHideTimer = null;
  };

  const showControls = () => {
    if (disposed || art.isDestroy || !art.controls) return;
    art.controls.show = true;
  };

  const hideControls = () => {
    if (disposed || art.isDestroy || !art.controls) return;
    art.controls.show = false;
    if (art.setting?.show) {
      art.setting.show = false;
    }
  };

  const scheduleIdleHide = () => {
    clearIdleHideTimer();
    if (!pointerInside) return;
    pointerIdle = false;
    idleHideTimer = window.setTimeout(() => {
      idleHideTimer = null;
      if (!pointerInside) return;
      pointerIdle = true;
      hideControls();
    }, PLAYER_HOVER_CONTROLS_IDLE_HIDE_MS);
  };

  const markPointerActive = () => {
    pointerInside = true;
    showControls();
    scheduleIdleHide();
  };

  const handlePointerLeave = () => {
    pointerInside = false;
    pointerIdle = false;
    clearIdleHideTimer();
    hideControls();
  };

  const handleControlState = (state: unknown) => {
    if (state === false && pointerInside && !pointerIdle) {
      showControls();
    }
  };

  const handlePlayerTick = () => {
    if (pointerInside && !pointerIdle) {
      showControls();
    }
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearIdleHideTimer();
    player.removeEventListener('mouseenter', markPointerActive);
    player.removeEventListener('mousemove', markPointerActive);
    player.removeEventListener('mouseleave', handlePointerLeave);
    art.off?.('control', handleControlState);
    art.off?.('video:timeupdate', handlePlayerTick);
    art.off?.('destroy', cleanup);
  };

  player.addEventListener('mouseenter', markPointerActive);
  player.addEventListener('mousemove', markPointerActive);
  player.addEventListener('mouseleave', handlePointerLeave);
  art.on?.('control', handleControlState);
  art.on?.('video:timeupdate', handlePlayerTick);
  art.on?.('destroy', cleanup);

  if (pointerInside) {
    showControls();
    scheduleIdleHide();
  }

  return cleanup;
}

type HlsLoaderFactoryOptions = {
  rewriteContext?: (context: LoaderContext) => void;
  transformManifestText?: (content: string, context: LoaderContext) => string;
};

/**
 * 构造可复用的 HLS Loader：支持请求上下文改写，以及对 manifest/level 文本做二次处理。
 */
export function createHlsLoaderClass(
  BaseLoader: HlsLoaderConstructor,
  options: HlsLoaderFactoryOptions,
): HlsLoaderConstructor {
  return class extends BaseLoader {
    constructor(config: unknown) {
      super(config);

      const load = this.load.bind(this);
      this.load = function (
        context: unknown,
        loadConfig: unknown,
        callbacks: unknown,
      ) {
        const loaderContext = context as LoaderContext;
        const loaderCallbacks = callbacks as LoaderCallbacks;

        options.rewriteContext?.(loaderContext);

        if (
          options.transformManifestText &&
          (loaderContext.type === 'manifest' ||
            loaderContext.type === 'level') &&
          loaderCallbacks.onSuccess
        ) {
          const onSuccess = loaderCallbacks.onSuccess;
          loaderCallbacks.onSuccess = function (
            response: unknown,
            stats: unknown,
            callbackContext: unknown,
            networkDetails?: unknown,
          ) {
            const nextResponse = response as { data?: unknown };
            if (typeof nextResponse.data === 'string') {
              nextResponse.data = options.transformManifestText!(
                nextResponse.data,
                loaderContext,
              );
            }
            return onSuccess(response, stats, callbackContext, networkDetails);
          };
        }

        load(context, loadConfig, callbacks);
      };
    }
  };
}
