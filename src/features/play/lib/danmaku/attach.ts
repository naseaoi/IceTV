import { createDanmakuPlugin } from '@/features/play/lib/danmaku/plugin';
import {
  type DanmakuLoadContext,
  loadDanmakuForEpisode,
} from '@/features/play/lib/danmaku/resolve';
import type { DanmakuItem } from '@/features/play/lib/danmaku/types';
import {
  readDanmakuEnabled,
  readDanmakuFontSize,
  readDanmakuOpacity,
  writeDanmakuEnabled,
  writeDanmakuFontSize,
  writeDanmakuOpacity,
} from '@/lib/local-preferences';
import { getRuntimeConfig } from '@/lib/runtime-config';

const PLUGIN_NAME = 'artplayerPluginDanmuku';

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
  plugins?: Record<string, unknown>;
  controls?: Record<string, HTMLElement | undefined>;
  on?: (event: never, handler: (...args: never[]) => unknown) => unknown;
};

type DanmakuEventBinder = (
  event: string,
  handler: (payload: DanmakuConfigEvent) => void,
) => unknown;

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
): () => Promise<DanmakuItem[]> {
  return () => loadDanmakuForEpisode(context);
}

// 站点未开启或本地关闭时不构造插件，避免无谓的动态 import
export async function createDanmakuPluginIfEnabled(
  context: DanmakuLoadContext,
) {
  if (!isDanmakuFeatureEnabled()) return null;

  try {
    return await createDanmakuPlugin({
      loadItems: buildDanmakuLoader(context),
      opacity: readDanmakuOpacity(),
      fontSize: readDanmakuFontSize(),
      visible: readDanmakuEnabled(),
      heatmap: true,
    });
  } catch (error) {
    console.warn('弹幕插件加载失败:', error);
    return null;
  }
}

// 控制热力图显隐
export function applyDanmakuHeatmapVisibility(
  player: PlayerWithPlugins | null,
  visible: boolean,
): void {
  const element = player?.controls?.heatmap;
  if (!element?.style) return;
  element.style.display = visible ? '' : 'none';
}

// 监听配置变更并持久化
export function bindDanmakuSettingPersistence(
  player: PlayerWithPlugins | null,
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

  on('artplayerPluginDanmuku:show', () => writeDanmakuEnabled(true));
  on('artplayerPluginDanmuku:hide', () => writeDanmakuEnabled(false));
}

// load() 无参时清空旧弹幕，带参时追加；重载前需更新 option.danmuku
export async function reloadDanmaku(
  player: PlayerWithPlugins | null,
  context: DanmakuLoadContext,
): Promise<void> {
  const api = getDanmakuPluginApi(player);
  if (!api?.option) return;

  try {
    api.option.danmuku = buildDanmakuLoader(context);
    await api.load();
  } catch (error) {
    console.warn('弹幕重载失败:', error);
  }
}
