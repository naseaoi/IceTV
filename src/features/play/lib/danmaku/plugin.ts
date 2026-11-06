import type { DanmakuItem } from '@/features/play/lib/danmaku/types';
import { USER_DANMAKU_MAX_LENGTH } from '@/lib/user-danmaku';

export interface DanmakuPluginOptions {
  loadItems: () => Promise<DanmakuItem[]>;
  opacity: number;
  fontSize: number;
  visible: boolean;
  heatmap: boolean;
  // 传入时渲染发送框，返回 true 才会在本地立即显示
  beforeEmit?: (danmu: DanmakuEmitPayload) => Promise<boolean>;
}

export interface DanmakuEmitPayload {
  text: string;
  mode?: number;
  color?: string;
  time?: number;
}

// 发送成功后输入框的锁定秒数，与服务端每分钟限额配合防连发
const EMIT_LOCK_SECONDS = 5;

// 插件会把 time=0 改写成当前播放位置
const MIN_ITEM_TIME = 0.01;
// 插件默认步长在容器宽度小于 100px 时会变成 0，导致热力图死循环。
export const DANMAKU_HEATMAP_SAMPLING_PX = 5;

export function resolveDanmakuHeatmapOption(enabled: boolean) {
  return enabled ? { sampling: DANMAKU_HEATMAP_SAMPLING_PX } : false;
}

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
  beforeEmit,
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
    emitter: Boolean(beforeEmit),
    ...(beforeEmit && {
      beforeEmit,
      maxLength: USER_DANMAKU_MAX_LENGTH,
      lockTime: EMIT_LOCK_SECONDS,
    }),
    heatmap: resolveDanmakuHeatmapOption(heatmap),
    theme: 'dark',
  });
}
