import type HlsType from 'hls.js';

import type { SourcePlaybackRoute } from '@/lib/proxy-modes';
import { isServerRelayPausedHlsError } from '@/lib/server-relay';

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
  setting?: { show: boolean; resize?: () => void; render?: () => void };
  template?: {
    $player?: HTMLElement;
    $video?: HTMLVideoElement;
  };
  on?: (event: string, callback: (...args: unknown[]) => void) => unknown;
  off?: (event: string, callback?: (...args: unknown[]) => void) => unknown;
  isDestroy?: boolean;
};

type MobileControlsArtPlayer = HoverControlsArtPlayer & {
  constructor?: {
    DBCLICK_TIME?: number;
    FAST_FORWARD_TIME?: number;
    FAST_FORWARD_VALUE?: number;
  };
  isLock?: boolean;
  playing?: boolean;
  playbackRate?: number;
  currentTime?: number;
  duration?: number;
  toggle?: () => void;
  __icetvFastForwardActive?: boolean;
};

const PLAYER_HOVER_CONTROLS_IDLE_HIDE_MS = 2_000;
const PLAYER_SETTING_HOVER_CLOSE_MS = 250;
const PLAYER_MOBILE_TOUCH_MOVE_THRESHOLD_PX = 10;
const PLAYER_MOBILE_CLICK_SUPPRESS_MS = 700;
const PLAYER_DEFAULT_FAST_FORWARD_TIME_MS = 1_000;
const PLAYER_DEFAULT_FAST_FORWARD_VALUE = 3;
const PLAYER_DOUBLE_TAP_SEEK_ZONE_RATIO = 0.35;
const PLAYER_DOUBLE_TAP_FEEDBACK_MS = 800;
const SEEK_BACKWARD_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>';
const SEEK_FORWARD_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>';
const PLAYER_LOCK_CONTROL_SELECTOR =
  '.art-bottom, .art-controls, .art-progress, .art-settings, .art-contextmenus';
const PLAYER_LOCK_TOGGLE_SELECTOR = '.art-layer-lock';
const PLAYER_LOCKED_CONTROL_EVENTS = [
  'click',
  'touchstart',
  'touchmove',
  'touchend',
  'pointerdown',
  'pointermove',
  'pointerup',
  'mousedown',
  'mousemove',
  'mouseup',
] as const;

interface PlayerMobileControlsOptions {
  enableLongPressFastForward?: boolean;
  /** 双击画面左右两侧快退 / 快进的秒数，不传时双击任意位置切换播放 */
  doubleTapSeekSeconds?: number;
}

export type ManagedVideoElement = HTMLVideoElement & {
  hls?: HlsType | null;
  __icetvHlsCleanup?: (() => void) | null;
  __icetvOnRuntimeReleased?: () => void;
  __icetvClientAdFilter?: boolean;
  __icetvFragmentHttpCacheRecovery?: boolean;
  /** HLS 事件处理器引用，复用时先移除旧的再绑定新的 */
  __icetvHlsHandlers?: {
    onError: (...args: unknown[]) => void;
    onFragLoaded: (...args: unknown[]) => void;
    onFragLoading?: (...args: unknown[]) => void;
    onFragBuffered?: (...args: unknown[]) => void;
    onLevelLoaded?: (...args: unknown[]) => void;
    onManifestParsed?: (...args: unknown[]) => void;
  } | null;
  /** 当前会话内该 video 实际使用的流量路由，供起播成功后清理短期兜底记忆。 */
  __icetvUsingServerProxy?: boolean;
  // 自动线路加载超时时尝试本意图尚未使用的另一线路，固定线路返回 false。
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

  playerModulesPromise = Promise.all([import('artplayer'), import('hls.js')])
    .then(([{ default: Artplayer }, { default: Hls }]) => ({
      Artplayer,
      Hls,
    }))
    .catch((error) => {
      playerModulesPromise = null;
      throw error;
    });

  return playerModulesPromise;
}

/** 预热播放器模块：页面加载时调用，提前触发动态导入 */
export function preloadPlayerModules(): void {
  void getPlayerModules().catch(() => undefined);
}

/** 预取 m3u8 代理地址（与模块加载并行），填充服务端缓存 */
export function prefetchM3U8(
  proxyUrl: string,
  route: Pick<SourcePlaybackRoute, 'directManifest'>,
): void {
  if (route.directManifest) return;
  fetch(proxyUrl, {
    cache: 'no-store',
    headers: { 'X-IceTV-Warm-Only': '1' },
  }).catch(() => {});
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
  managedVideo.__icetvOnRuntimeReleased?.();
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

function isArtPlayerMobile(player: HTMLElement): boolean {
  return player.classList.contains('art-mobile');
}

function getEventTargetElement(event: Event): HTMLElement | null {
  const target = event.target;
  return target instanceof HTMLElement ? target : null;
}

function isEventFromElement(event: Event, element: Element): boolean {
  const path =
    typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (path.includes(element)) return true;

  const target = event.target;
  return target instanceof Node && element.contains(target);
}

function stopPlayerControlEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function shouldBlockLockedControlEvent(event: Event): boolean {
  const target = getEventTargetElement(event);
  if (!target) return false;
  if (target.closest(PLAYER_LOCK_TOGGLE_SELECTOR)) return false;
  return !!target.closest(PLAYER_LOCK_CONTROL_SELECTOR);
}

function hidePlayerControls(art: MobileControlsArtPlayer): void {
  if (!art.controls) return;
  art.controls.show = false;
  if (art.setting?.show) {
    art.setting.show = false;
  }
}

export function isPlayerFastForwarding(artPlayer: unknown): boolean {
  const art = artPlayer as MobileControlsArtPlayer;
  if (art.__icetvFastForwardActive) return true;

  const fastForwardValue =
    art.constructor?.FAST_FORWARD_VALUE ?? PLAYER_DEFAULT_FAST_FORWARD_VALUE;
  const playbackRate = Number(art.playbackRate);
  if (Math.abs(playbackRate - fastForwardValue) > 0.01) return false;

  return !!art.template?.$player?.classList.contains('art-fast-forward');
}

export function restorePlayerPlaybackRate(
  artPlayer: unknown,
  playbackRate: number,
): void {
  const art = artPlayer as MobileControlsArtPlayer;
  const safePlaybackRate =
    Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;

  art.__icetvFastForwardActive = false;
  art.template?.$player?.classList.remove('art-fast-forward');

  if (
    typeof art.playbackRate === 'number' &&
    Math.abs(art.playbackRate - safePlaybackRate) <= 0.01
  ) {
    return;
  }

  art.playbackRate = safePlaybackRate;
}

// 有悬停能力的指针设备上，设置面板随齿轮悬浮打开、移出后关闭，与弹幕设置面板一致；触屏仍用点击切换。
function bindPlayerSettingHover(
  art: HoverControlsArtPlayer,
  player: HTMLElement,
): () => void {
  const setting = art.setting;
  const gear = player.querySelector<HTMLElement>('.art-control-setting');
  const panel = player.querySelector<HTMLElement>('.art-settings');
  if (
    !setting ||
    !gear ||
    !panel ||
    !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  ) {
    return () => {};
  }

  let closeTimer: number | null = null;
  const cancelClose = () => {
    if (!closeTimer) return;
    window.clearTimeout(closeTimer);
    closeTimer = null;
  };
  const open = () => {
    cancelClose();
    if (art.isDestroy || setting.show) return;
    setting.show = true;
    setting.resize?.();
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer = window.setTimeout(() => {
      closeTimer = null;
      if (art.isDestroy || !setting.show) return;
      setting.show = false;
      // 与 ArtPlayer 失焦关闭一致，下次打开回到一级菜单
      setting.render?.();
    }, PLAYER_SETTING_HOVER_CLOSE_MS);
  };
  // 悬浮已打开面板，点击齿轮若沿用内置切换会把面板关掉
  const keepOpenOnClick = (event: Event) => {
    event.stopImmediatePropagation();
    open();
  };

  const hoverTargets = [gear, panel];
  for (const target of hoverTargets) {
    target.addEventListener('mouseenter', open);
    target.addEventListener('mouseleave', scheduleClose);
  }
  gear.addEventListener('click', keepOpenOnClick, true);

  return () => {
    cancelClose();
    for (const target of hoverTargets) {
      target.removeEventListener('mouseenter', open);
      target.removeEventListener('mouseleave', scheduleClose);
    }
    gear.removeEventListener('click', keepOpenOnClick, true);
  };
}

export function bindPlayerHoverControls(artPlayer: unknown): () => void {
  const art = artPlayer as HoverControlsArtPlayer;
  const player = art.template?.$player;
  if (!player || !art.controls) return () => {};
  if (isArtPlayerMobile(player)) return () => {};

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
      // 设置面板打开时停在面板上阅读不算闲置，与 ArtPlayer 自身的隐藏条件一致
      if (!pointerInside || art.setting?.show) return;
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

  const cleanupSettingHover = bindPlayerSettingHover(art, player);

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearIdleHideTimer();
    cleanupSettingHover();
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

export function bindPlayerMobileControls(
  artPlayer: unknown,
  {
    enableLongPressFastForward = true,
    doubleTapSeekSeconds,
  }: PlayerMobileControlsOptions = {},
): () => void {
  const art = artPlayer as MobileControlsArtPlayer;
  const player = art.template?.$player;
  const video = art.template?.$video;
  if (!player || !video || !art.controls || !isArtPlayerMobile(player)) {
    return () => {};
  }

  let disposed = false;
  let pressTimer: number | null = null;
  let fastForwardActive = false;
  let previousPlaybackRate = 1;
  let suppressClickUntil = 0;
  let startTouch: { x: number; y: number } | null = null;

  const clearPressTimer = () => {
    if (pressTimer === null) return;
    window.clearTimeout(pressTimer);
    pressTimer = null;
  };

  const finishFastForward = () => {
    clearPressTimer();
    if (!fastForwardActive) {
      startTouch = null;
      return;
    }

    suppressClickUntil = Date.now() + PLAYER_MOBILE_CLICK_SUPPRESS_MS;
    fastForwardActive = false;
    startTouch = null;
    restorePlayerPlaybackRate(art, previousPlaybackRate);
    hidePlayerControls(art);
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (
      disposed ||
      event.touches.length !== 1 ||
      !art.playing ||
      !isEventFromElement(event, video)
    ) {
      return;
    }

    const touch = event.touches[0];
    startTouch = { x: touch.clientX, y: touch.clientY };
    previousPlaybackRate =
      typeof art.playbackRate === 'number' && art.playbackRate > 0
        ? art.playbackRate
        : 1;
    clearPressTimer();

    pressTimer = window.setTimeout(() => {
      if (disposed || !startTouch || !art.playing) return;

      fastForwardActive = true;
      art.__icetvFastForwardActive = true;
      art.template?.$player?.classList.add('art-fast-forward');
      art.playbackRate =
        art.constructor?.FAST_FORWARD_VALUE ??
        PLAYER_DEFAULT_FAST_FORWARD_VALUE;
      suppressClickUntil = Date.now() + PLAYER_MOBILE_CLICK_SUPPRESS_MS;
      hidePlayerControls(art);
    }, art.constructor?.FAST_FORWARD_TIME ?? PLAYER_DEFAULT_FAST_FORWARD_TIME_MS);
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!startTouch || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const moved = Math.hypot(
      touch.clientX - startTouch.x,
      touch.clientY - startTouch.y,
    );
    if (moved <= PLAYER_MOBILE_TOUCH_MOVE_THRESHOLD_PX) return;

    finishFastForward();
  };

  const handleTouchEnd = () => {
    finishFastForward();
  };

  const handleClickCapture = (event: MouseEvent) => {
    if (Date.now() > suppressClickUntil) return;
    stopPlayerControlEvent(event);
    hidePlayerControls(art);
  };

  const handleLockedControlCapture = (event: Event) => {
    if (!art.isLock || !shouldBlockLockedControlEvent(event)) return;
    stopPlayerControlEvent(event);
  };

  // 连续双击同一侧累加显示总秒数
  let seekFeedback: {
    element: HTMLDivElement;
    direction: -1 | 1;
    total: number;
    timer: number;
  } | null = null;

  const removeSeekFeedback = () => {
    if (!seekFeedback) return;
    window.clearTimeout(seekFeedback.timer);
    seekFeedback.element.remove();
    seekFeedback = null;
  };

  const showSeekFeedback = (direction: -1 | 1, seconds: number) => {
    const total =
      seekFeedback?.direction === direction
        ? seekFeedback.total + seconds
        : seconds;
    removeSeekFeedback();
    const element = document.createElement('div');
    element.className = `ice-seek-feedback ice-seek-feedback-${direction < 0 ? 'backward' : 'forward'}`;
    element.innerHTML = `${direction < 0 ? SEEK_BACKWARD_ICON : SEEK_FORWARD_ICON}<span>${total} 秒</span>`;
    player.appendChild(element);
    seekFeedback = {
      element,
      direction,
      total,
      timer: window.setTimeout(
        removeSeekFeedback,
        PLAYER_DOUBLE_TAP_FEEDBACK_MS,
      ),
    };
  };

  const resolveDoubleTapDirection = (event: unknown): -1 | 1 | null => {
    if (!doubleTapSeekSeconds || !(event instanceof MouseEvent)) return null;
    const rect = player.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = (event.clientX - rect.left) / rect.width;
    if (ratio < PLAYER_DOUBLE_TAP_SEEK_ZONE_RATIO) return -1;
    if (ratio > 1 - PLAYER_DOUBLE_TAP_SEEK_ZONE_RATIO) return 1;
    return null;
  };

  // Artplayer 内置的移动端双击播放已在 configureArtplayerStatics 关闭，统一在这里处理
  const handleDblClick = (event?: unknown) => {
    const direction = art.isLock ? null : resolveDoubleTapDirection(event);
    const duration = art.duration ?? 0;
    if (direction === null || !doubleTapSeekSeconds || !(duration > 0)) {
      art.toggle?.();
      return;
    }
    const current = art.currentTime ?? 0;
    art.currentTime = Math.min(
      Math.max(0, current + direction * doubleTapSeekSeconds),
      duration,
    );
    showSeekFeedback(direction, doubleTapSeekSeconds);
  };

  const captureOptions: AddEventListenerOptions = {
    capture: true,
    passive: false,
  };
  const passiveOptions: AddEventListenerOptions = { passive: true };

  if (enableLongPressFastForward) {
    video.addEventListener('touchstart', handleTouchStart, passiveOptions);
    video.addEventListener('touchmove', handleTouchMove, passiveOptions);
    document.addEventListener('touchend', handleTouchEnd, passiveOptions);
    document.addEventListener('touchcancel', handleTouchEnd, passiveOptions);
    video.addEventListener('click', handleClickCapture, true);
  }

  for (const eventName of PLAYER_LOCKED_CONTROL_EVENTS) {
    player.addEventListener(
      eventName,
      handleLockedControlCapture,
      captureOptions,
    );
  }

  art.on?.('dblclick', handleDblClick);

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearPressTimer();
    removeSeekFeedback();
    art.__icetvFastForwardActive = false;
    player.classList.remove('art-fast-forward');
    if (enableLongPressFastForward) {
      video.removeEventListener('touchstart', handleTouchStart, passiveOptions);
      video.removeEventListener('touchmove', handleTouchMove, passiveOptions);
      document.removeEventListener('touchend', handleTouchEnd, passiveOptions);
      document.removeEventListener(
        'touchcancel',
        handleTouchEnd,
        passiveOptions,
      );
      video.removeEventListener('click', handleClickCapture, true);
    }

    for (const eventName of PLAYER_LOCKED_CONTROL_EVENTS) {
      player.removeEventListener(
        eventName,
        handleLockedControlCapture,
        captureOptions,
      );
    }

    art.off?.('dblclick', handleDblClick);
    art.off?.('destroy', cleanup);
  };

  art.on?.('destroy', cleanup);

  return cleanup;
}

type RetryDecider = (
  retryConfig: unknown,
  retryCount: number,
  isTimeout: boolean,
  loaderResponse: unknown,
  retry: boolean,
) => boolean;

type LoaderConfig = {
  loadPolicy?: {
    errorRetry?: { shouldRetry?: RetryDecider } | null;
  };
};

// 服务器中转暂停时重试注定失败，跳过 hls.js 内部重试，让播放层首个错误即可处理
function skipRetryWhenRelayPaused(
  loadConfig: unknown,
  getNetworkDetails: () => unknown,
): unknown {
  const config = loadConfig as LoaderConfig | null;
  const errorRetry = config?.loadPolicy?.errorRetry;
  if (!errorRetry) return loadConfig;
  const shouldRetry = errorRetry.shouldRetry;
  return {
    ...config,
    loadPolicy: {
      ...config.loadPolicy,
      errorRetry: {
        ...errorRetry,
        shouldRetry: ((retryConfig, retryCount, isTimeout, response, retry) => {
          if (
            isServerRelayPausedHlsError({ networkDetails: getNetworkDetails() })
          ) {
            return false;
          }
          return shouldRetry
            ? shouldRetry(retryConfig, retryCount, isTimeout, response, retry)
            : retry;
        }) satisfies RetryDecider,
      },
    },
  };
}

type HlsLoaderFactoryOptions = {
  rewriteContext?: (context: LoaderContext) => void;
  transformManifestText?: (
    content: string,
    context: LoaderContext,
    manifestUrl: string,
  ) => string;
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

      const instance = this as unknown as { loader?: unknown };
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
            const nextResponse = response as { data?: unknown; url?: string };
            if (typeof nextResponse.data === 'string') {
              nextResponse.data = options.transformManifestText!(
                nextResponse.data,
                loaderContext,
                nextResponse.url || loaderContext.url || '',
              );
            }
            return onSuccess(response, stats, callbackContext, networkDetails);
          };
        }

        load(
          context,
          skipRetryWhenRelayPaused(loadConfig, () => instance.loader),
          callbacks,
        );
      };
    }
  };
}
