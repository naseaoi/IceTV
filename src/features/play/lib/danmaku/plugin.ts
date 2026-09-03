import type { DanmakuItem } from '@/features/play/lib/danmaku/types';

export interface DanmakuPluginOptions {
  loadItems: () => Promise<DanmakuItem[]>;
  opacity: number;
  fontSize: number;
  visible: boolean;
  heatmap: boolean;
}

// 插件会把 time=0 改写成当前播放位置
const MIN_ITEM_TIME = 0.01;

function clampItemTime(time: number): number {
  return time > 0 ? time : MIN_ITEM_TIME;
}

// 偏移为正表示弹幕整体延后出现
export function applyOffset(
  items: DanmakuItem[],
  offsetSeconds: number,
): DanmakuItem[] {
  if (!offsetSeconds) {
    return items.map((item) =>
      item.time > 0 ? item : { ...item, time: MIN_ITEM_TIME },
    );
  }

  const shifted: DanmakuItem[] = [];
  for (const item of items) {
    const time = item.time + offsetSeconds;
    if (time < 0) continue;
    shifted.push({ ...item, time: clampItemTime(time) });
  }
  return shifted;
}

export async function createDanmakuPlugin({
  loadItems,
  opacity,
  fontSize,
  visible,
  heatmap,
}: DanmakuPluginOptions) {
  const { default: artplayerPluginDanmuku } =
    await import('artplayer-plugin-danmuku');

  return artplayerPluginDanmuku({
    danmuku: loadItems,
    speed: 7.5,
    margin: [10, '25%'],
    opacity,
    fontSize,
    mode: 0,
    modes: [0, 1, 2],
    antiOverlap: true,
    synchronousPlayback: true,
    visible,
    // 第一期只读，不渲染发射器
    emitter: false,
    heatmap,
    theme: 'dark',
  });
}
