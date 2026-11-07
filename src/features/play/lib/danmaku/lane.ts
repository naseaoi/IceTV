import type { DanmakuMode } from '@/features/play/lib/danmaku/types';

// 插件 visibles 给出的在屏弹幕几何信息，坐标相对播放器
export interface VisibleDanmaku {
  mode: DanmakuMode;
  top: number;
  height: number;
  width: number;
  // 弹幕尾部到播放器右边缘的距离，为负说明尾部还没进入画面
  right: number;
  // 弹幕尾部到播放器左边缘的距离
  distance: number;
  // 每秒移动像素
  speed: number;
  // 剩余显示秒数
  time: number;
}

export interface DanmakuTopRequest {
  target: { mode: DanmakuMode; height: number; speed: number };
  visibles: VisibleDanmaku[];
  clientWidth: number;
  clientHeight: number;
  marginTop: number;
  marginBottom: number;
  antiOverlap: boolean;
}

// 同行前后两条滚动弹幕的最小水平间距，按弹幕高度计
const FOLLOW_GAP_RATIO = 1;

function overlapsVertically(item: VisibleDanmaku, top: number, height: number) {
  return item.top < top + height && top < item.top + item.height;
}

// 新弹幕从右边缘出发，在前一条离场前追不上它的尾部才算可同行
function canFollow(
  item: VisibleDanmaku,
  target: DanmakuTopRequest['target'],
): boolean {
  if (item.right < target.height * FOLLOW_GAP_RATIO) return false;
  if (target.speed <= item.speed) return true;
  return item.right / (target.speed - item.speed) > item.time;
}

function fits(
  top: number,
  request: DanmakuTopRequest,
  peers: VisibleDanmaku[],
): boolean {
  const { target } = request;
  for (const item of peers) {
    if (!overlapsVertically(item, top, target.height)) continue;
    if (target.mode !== 0 || !canFollow(item, target)) return false;
  }
  return true;
}

// 防重叠关闭时的兜底：滚动弹幕挑最空的位置，静止弹幕挑遮挡最少的位置
function leastCrowded(
  candidates: number[],
  request: DanmakuTopRequest,
  peers: VisibleDanmaku[],
): number | undefined {
  const { target } = request;
  let best: number | undefined;
  let bestScore = -Infinity;
  for (const top of candidates) {
    const overlapping = peers.filter((item) =>
      overlapsVertically(item, top, target.height),
    );
    const score =
      target.mode === 0
        ? Math.min(...overlapping.map((item) => item.right))
        : -overlapping.reduce((sum, item) => sum + item.width, 0);
    if (score > bestScore) {
      best = top;
      bestScore = score;
    }
  }
  return best;
}

// 顶部和滚动弹幕从上往下、底部弹幕从下往上，取第一个放得下的位置。
// 插件原逻辑优先找完全空着的行，弹幕稀疏时会逐行下移排成斜线，留空上方已腾出的行。
export function resolveDanmakuTop(
  request: DanmakuTopRequest,
): number | undefined {
  const { target, marginTop } = request;
  const maxTop = request.clientHeight - request.marginBottom;
  const peers = request.visibles.filter(
    (item) => item.mode === target.mode && item.top <= maxTop,
  );
  const fromBottom = target.mode === 2;

  const anchors = fromBottom
    ? [
        maxTop - target.height,
        ...peers.flatMap((item) => [
          item.top - target.height,
          item.top + item.height - target.height,
        ]),
      ]
    : [
        marginTop,
        ...peers.flatMap((item) => [item.top, item.top + item.height]),
      ];
  const candidates = [...new Set(anchors)]
    .filter((top) => top >= marginTop && top + target.height <= maxTop)
    .sort((a, b) => (fromBottom ? b - a : a - b));

  if (candidates.length === 0) {
    return fromBottom ? maxTop - target.height : marginTop;
  }

  const top = candidates.find((candidate) => fits(candidate, request, peers));
  if (top !== undefined || request.antiOverlap) return top;
  return leastCrowded(candidates, request, peers);
}
