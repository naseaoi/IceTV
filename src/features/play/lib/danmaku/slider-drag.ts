// artplayer 只广播 document:mousemove/mouseup，弹幕插件滑条却监听 document:pointermove/pointerup
// 缺失的两个事件补进播放器事件总线，滑条才能拖动
type PlayerWithEmitter = {
  emit?: (name: never, ...args: unknown[]) => unknown;
};

const BRIDGED_EVENTS: Array<{ dom: string; bus: string }> = [
  { dom: 'pointermove', bus: 'document:pointermove' },
  { dom: 'pointerup', bus: 'document:pointerup' },
  { dom: 'pointercancel', bus: 'document:pointerup' },
];

export function bindDanmakuSliderDrag(
  player: PlayerWithEmitter | null,
): () => void {
  if (typeof document === 'undefined' || typeof player?.emit !== 'function') {
    return () => undefined;
  }

  const emit = player.emit.bind(player) as (
    name: string,
    ...args: unknown[]
  ) => unknown;
  const listeners = BRIDGED_EVENTS.map(({ dom, bus }) => {
    const handler = (event: Event) => {
      emit(bus, event);
    };
    document.addEventListener(dom, handler, { passive: true });
    return { dom, handler };
  });

  return () => {
    for (const { dom, handler } of listeners) {
      document.removeEventListener(dom, handler);
    }
  };
}
