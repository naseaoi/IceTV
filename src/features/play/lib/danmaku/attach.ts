import {
  type DanmakuLoadResult,
  beginDanmakuLoadNotice,
  clearDanmakuLoadNotice,
} from '@/features/play/lib/danmaku/load-notice';
import { createDanmakuPlugin } from '@/features/play/lib/danmaku/plugin';
import {
  type DanmakuEnabledReader,
  type DanmakuLoadContext,
  type DanmakuLoadOptions,
  loadDanmakuForEpisode,
} from '@/features/play/lib/danmaku/resolve';
import type { DanmakuItem } from '@/features/play/lib/danmaku/types';
import {
  readDanmakuFontSize,
  readDanmakuOpacity,
  writeDanmakuFontSize,
  writeDanmakuOpacity,
} from '@/lib/local-preferences';
import { getRuntimeConfig } from '@/lib/runtime-config';

const PLUGIN_NAME = 'artplayerPluginDanmuku';

type DanmakuLoadStatus = 'unloaded' | 'scheduled' | 'loading' | 'loaded';

interface AttachedDanmakuContext {
  contextKey: string;
  refreshData: boolean;
  status: DanmakuLoadStatus;
  task?: Promise<void>;
  failed?: boolean;
  loadEnabled?: boolean;
  reportResult?: (result: DanmakuLoadResult) => void;
  finishInitialLoad?: () => void;
}

const attachedDanmakuContexts = new WeakMap<object, AttachedDanmakuContext>();
const danmakuReloadChains = new WeakMap<object, Promise<void>>();
const activeDanmakuContexts = new WeakMap<object, AttachedDanmakuContext>();

type DanmakuPluginApi = {
  load: (danmuku?: () => Promise<DanmakuItem[]>) => Promise<unknown>;
  reset: () => unknown;
  hide: () => unknown;
  show: () => unknown;
  option?: { danmuku?: unknown };
};

type DanmakuConfigEvent = {
  opacity?: unknown;
  fontSize?: unknown;
  visible?: unknown;
};

type PlayerWithPlugins = {
  constructor?: Function & { NOTICE_TIME?: number };
  notice?: { show: string };
  template?: { $noticeInner?: HTMLElement };
  plugins?: Record<string, unknown>;
  controls?: Record<string, HTMLElement | undefined>;
  on?: (event: never, handler: (...args: never[]) => unknown) => unknown;
};

type DanmakuEventBinder = (
  event: string,
  handler: (payload: DanmakuConfigEvent) => void,
) => unknown;

export type DanmakuEnabledRef = { current: boolean };

export interface ReloadDanmakuOptions {
  forcePluginReload?: boolean;
  refreshData?: boolean;
}

export interface DanmakuSettingPersistenceOptions {
  enabledRef: DanmakuEnabledRef;
  onEnabledChange?: (enabled: boolean) => void;
  onEnable?: () => void;
}

// Artplayer 的 on 依赖 this.e，摘出方法再调用会抛错，必须绑回播放器
function bindPlayerEvent(player: PlayerWithPlugins): DanmakuEventBinder | null {
  if (typeof player.on !== 'function') return null;
  return player.on.bind(player) as unknown as DanmakuEventBinder;
}

export function isDanmakuFeatureEnabled(): boolean {
  return getRuntimeConfig()?.ENABLE_DANMAKU === true;
}

export function getDanmakuPluginApi(
  player: PlayerWithPlugins | null,
): DanmakuPluginApi | null {
  const api = player?.plugins?.[PLUGIN_NAME];
  if (!api || typeof api !== 'object') return null;

  const candidate = api as Partial<DanmakuPluginApi>;
  return typeof candidate.load === 'function' &&
    typeof candidate.reset === 'function'
    ? (api as DanmakuPluginApi)
    : null;
}

export function buildDanmakuLoader(
  context: DanmakuLoadContext,
  isEnabled: DanmakuEnabledReader,
  options: DanmakuLoadOptions = {},
): () => Promise<DanmakuItem[]> {
  return () => loadDanmakuForEpisode(context, isEnabled, options);
}

function buildAttachedContextKey(context: DanmakuLoadContext): string {
  return JSON.stringify([
    context.source.trim(),
    context.videoId.trim(),
    context.episodeIndex,
    context.searchTitle.trim(),
    context.searchYear.trim(),
  ]);
}

export function markDanmakuContextAttached(
  player: PlayerWithPlugins | null,
  context: DanmakuLoadContext,
  loadStartedWhileEnabled = true,
): void {
  if (!player) return;
  attachedDanmakuContexts.set(player, {
    contextKey: buildAttachedContextKey(context),
    refreshData: false,
    status: loadStartedWhileEnabled ? 'loading' : 'unloaded',
  });
}

// 站点未开启时不构造插件，避免无谓的动态 import；账号关闭由加载器返回空数据
export async function createDanmakuPluginIfEnabled(
  context: DanmakuLoadContext,
  enabledRef: DanmakuEnabledRef,
) {
  if (!isDanmakuFeatureEnabled()) return null;

  const isEnabled = () => enabledRef.current;
  let initialContext: AttachedDanmakuContext | undefined;

  try {
    const plugin = await createDanmakuPlugin({
      loadItems: buildDanmakuLoader(context, isEnabled, {
        onError: () => {
          if (initialContext) initialContext.failed = true;
        },
      }),
      opacity: readDanmakuOpacity(),
      fontSize: readDanmakuFontSize(),
      visible: enabledRef.current,
      heatmap: true,
    });

    return (player: Parameters<typeof plugin>[0]) => {
      markDanmakuContextAttached(player, context, enabledRef.current);
      initialContext = attachedDanmakuContexts.get(player);
      if (initialContext) {
        initialContext.loadEnabled = enabledRef.current;
        initialContext.reportResult = beginDanmakuLoadNotice(player, isEnabled);
        const initialTask = new Promise<void>((resolve) => {
          if (initialContext) initialContext.finishInitialLoad = resolve;
        });
        initialContext.task = initialTask;
        activeDanmakuContexts.set(player, initialContext);
        danmakuReloadChains.set(player, initialTask);
        const finishInitialLoad = initialContext.finishInitialLoad;
        player.on('destroy', () => {
          clearDanmakuLoadNotice(player);
          activeDanmakuContexts.delete(player);
          attachedDanmakuContexts.delete(player);
          finishInitialLoad?.();
        });
      }

      bindDanmakuLoaded(player, (count) => {
        finishDanmakuLoad(player, enabledRef, count);
      });
      bindPlayerEvent(player)?.('artplayerPluginDanmuku:error', () => {
        const activeContext = activeDanmakuContexts.get(player);
        if (activeContext) activeContext.failed = true;
        finishDanmakuLoad(player, enabledRef, 0);
      });
      return plugin(player);
    };
  } catch (error) {
    console.warn('弹幕插件加载失败:', error);
    return null;
  }
}

function finishDanmakuLoad(
  player: PlayerWithPlugins,
  enabledRef: DanmakuEnabledRef,
  count: number,
): void {
  const context = activeDanmakuContexts.get(player);
  if (!context) return;
  activeDanmakuContexts.delete(player);
  context.status =
    context.loadEnabled && !context.failed ? 'loaded' : 'unloaded';
  if (
    attachedDanmakuContexts.get(player) === context &&
    context.loadEnabled &&
    enabledRef.current
  ) {
    context.reportResult?.(
      context.failed
        ? { status: 'error' }
        : count > 0
          ? { status: 'loaded', count }
          : { status: 'empty' },
    );
  }
  context.finishInitialLoad?.();
}

// 控制热力图显隐
export function applyDanmakuHeatmapVisibility(
  player: PlayerWithPlugins | null,
  visible: boolean,
): void {
  const element = player?.controls?.heatmap;
  if (!element?.style) return;
  // 保留容器宽度，避免第三方热力图在隐藏时用 0 宽度生成无效路径。
  element.style.display = '';
  element.style.visibility = visible ? '' : 'hidden';
}

// 监听配置变更、持久化，并在开启边沿触发数据重载
export function bindDanmakuSettingPersistence(
  player: PlayerWithPlugins | null,
  options: DanmakuSettingPersistenceOptions,
): void {
  if (!player) return;
  const on = bindPlayerEvent(player);
  if (!on) return;

  on('artplayerPluginDanmuku:config', (option) => {
    if (typeof option?.opacity === 'number')
      writeDanmakuOpacity(option.opacity);
    if (typeof option?.fontSize === 'number') {
      writeDanmakuFontSize(option.fontSize);
    }
  });

  on('artplayerPluginDanmuku:show', () => {
    const wasEnabled = options.enabledRef.current;
    if (wasEnabled) return;
    options.enabledRef.current = true;
    options.onEnabledChange?.(true);
    options.onEnable?.();
  });
  on('artplayerPluginDanmuku:hide', () => {
    clearDanmakuLoadNotice(player);
    if (!options.enabledRef.current) return;
    options.enabledRef.current = false;
    options.onEnabledChange?.(false);
  });
}

// 插件完成队列装载后回传实际进入播放器的条数
export function bindDanmakuLoaded(
  player: PlayerWithPlugins | null,
  onLoaded: (count: number) => void,
): void {
  if (!player) return;
  const on = bindPlayerEvent(player);
  if (!on) return;

  on('artplayerPluginDanmuku:loaded', (items) => {
    onLoaded(Array.isArray(items) ? items.length : 0);
  });
}

// load() 无参时清空旧弹幕，带参时追加；重载前需更新 option.danmuku
export async function reloadDanmaku(
  player: PlayerWithPlugins | null,
  context: DanmakuLoadContext,
  enabledRef: DanmakuEnabledRef,
  options: ReloadDanmakuOptions = {},
): Promise<void> {
  if (!player) return;
  const api = getDanmakuPluginApi(player);
  if (!api?.option) return;
  const option = api.option;

  const contextKey = buildAttachedContextKey(context);
  const attachedContext = attachedDanmakuContexts.get(player);
  if (
    !options.forcePluginReload &&
    attachedContext?.contextKey === contextKey
  ) {
    await attachedContext.task;
    return;
  }
  if (
    options.forcePluginReload &&
    attachedContext?.contextKey === contextKey &&
    (attachedContext.status === 'scheduled' ||
      attachedContext.status === 'loading') &&
    (attachedContext.refreshData || !options.refreshData)
  ) {
    await attachedContext.task;
    return;
  }

  const nextContext: AttachedDanmakuContext = {
    contextKey,
    refreshData: options.refreshData === true,
    status: 'scheduled',
    reportResult: beginDanmakuLoadNotice(player, () => enabledRef.current),
  };
  attachedDanmakuContexts.set(player, nextContext);

  const previousTask = danmakuReloadChains.get(player);
  const task = (async () => {
    await previousTask?.catch(() => {});
    if (attachedDanmakuContexts.get(player) !== nextContext) return;

    const loadEnabled = enabledRef.current;
    nextContext.loadEnabled = loadEnabled;
    nextContext.status = loadEnabled ? 'loading' : 'unloaded';
    activeDanmakuContexts.set(player, nextContext);
    option.danmuku = buildDanmakuLoader(context, () => loadEnabled, {
      forceRefresh: nextContext.refreshData,
      onError: () => {
        nextContext.failed = true;
      },
    });

    try {
      await api.load();
      if (attachedDanmakuContexts.get(player) === nextContext) {
        nextContext.status =
          loadEnabled && !nextContext.failed ? 'loaded' : 'unloaded';
      }
    } catch (error) {
      nextContext.failed = true;
      if (activeDanmakuContexts.get(player) === nextContext) {
        finishDanmakuLoad(player, enabledRef, 0);
      }
      if (attachedDanmakuContexts.get(player) === nextContext) {
        nextContext.status = 'unloaded';
      }
      console.warn('弹幕重载失败:', error);
    }
  })();
  nextContext.task = task;
  danmakuReloadChains.set(player, task);
  await task;
  if (danmakuReloadChains.get(player) === task) {
    danmakuReloadChains.delete(player);
  }
}

export async function ensureDanmakuLoaded(
  player: PlayerWithPlugins | null,
  context: DanmakuLoadContext,
  enabledRef: DanmakuEnabledRef,
): Promise<void> {
  if (!player || !enabledRef.current) return;

  const contextKey = buildAttachedContextKey(context);
  const attachedContext = attachedDanmakuContexts.get(player);
  if (
    attachedContext?.contextKey === contextKey &&
    attachedContext.status !== 'unloaded'
  ) {
    await attachedContext.task;
    return;
  }

  await reloadDanmaku(player, context, enabledRef, {
    forcePluginReload: true,
  });
}
