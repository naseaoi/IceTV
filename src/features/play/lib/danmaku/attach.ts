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
} from '@/lib/local-preferences';
import { getRuntimeConfig } from '@/lib/runtime-config';

const PLUGIN_NAME = 'artplayerPluginDanmuku';

type DanmakuPluginApi = {
  load: (danmuku?: () => Promise<DanmakuItem[]>) => Promise<unknown>;
  reset: () => unknown;
  hide: () => unknown;
  show: () => unknown;
};

type PlayerWithPlugins = {
  plugins?: Record<string, unknown>;
};

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
    });
  } catch (error) {
    console.warn('弹幕插件加载失败:', error);
    return null;
  }
}

// 播放器复用与开关/偏移变更时插件都不会自行重新调用加载器，必须显式重载
export async function reloadDanmaku(
  player: PlayerWithPlugins | null,
  context: DanmakuLoadContext,
): Promise<void> {
  const api = getDanmakuPluginApi(player);
  if (!api) return;

  try {
    api.reset();
    await api.load(buildDanmakuLoader(context));
  } catch (error) {
    console.warn('弹幕重载失败:', error);
  }
}
