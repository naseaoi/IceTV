'use client';

import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  animateWithFallback,
  offsetInContainer,
  prefersReducedMotion,
  readMotionEasing,
} from '@/lib/motion-dom';

interface IndicatorBox {
  x: number;
  width: number;
  top: number;
}

interface SlidingIndicatorOptions {
  // 固定宽度的短指示条居中于目标项；缺省时与目标项等宽
  width?: number;
  // 随页面重新挂载的导航传入同一个 key，从上一页的位置滑到当前项
  memoryKey?: string;
}

// 指示条对准带此属性的元素；与 aria-current 分开，导航可以在路由切换完成前先移过去
export const INDICATOR_TARGET_ATTR = 'data-indicator-target';

const SLIDE_MS = 460;
// 拉伸阶段：前沿先走完大半程，后沿只走一小段，随后一起弹簧落位
const STRETCH_OFFSET = 0.38;
const LEAD_PROGRESS = 0.82;
const TRAIL_PROGRESS = 0.28;

const rememberedBoxes = new Map<string, IndicatorBox>();

function toContainerBox(container: HTMLElement, rect: DOMRect) {
  const offset = offsetInContainer(container, rect);
  return { x: offset.x, width: offset.width, bottom: offset.y + offset.height };
}

function measureTarget(
  container: HTMLElement,
  width: number | undefined,
): IndicatorBox | null {
  const target = container.querySelector<HTMLElement>(
    `[${INDICATOR_TARGET_ATTR}]`,
  );
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width === 0) return null;
  const box = toContainerBox(container, rect);
  const indicatorWidth = width ?? box.width;
  return {
    x: box.x + (box.width - indicatorWidth) / 2,
    width: indicatorWidth,
    top: box.bottom,
  };
}

function sameBox(a: IndicatorBox, b: IndicatorBox) {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5
  );
}

// 指示条布局在容器左缘，以左缘为原点先缩放再平移
function slideTransform(left: number, right: number, width: number) {
  const scale = Math.max(right - left, 0.01) / width;
  return `translateX(${left}px) scaleX(${scale})`;
}

function playSlide(
  element: HTMLElement,
  from: Pick<IndicatorBox, 'x' | 'width'>,
  to: IndicatorBox,
) {
  if (prefersReducedMotion()) return;
  const fromRight = from.x + from.width;
  const toRight = to.x + to.width;
  const forward = to.x + to.width / 2 >= from.x + from.width / 2;
  const leftProgress = forward ? TRAIL_PROGRESS : LEAD_PROGRESS;
  const rightProgress = forward ? LEAD_PROGRESS : TRAIL_PROGRESS;
  const keyframes = [
    { transform: slideTransform(from.x, fromRight, to.width) },
    {
      offset: STRETCH_OFFSET,
      transform: slideTransform(
        from.x + (to.x - from.x) * leftProgress,
        fromRight + (toRight - fromRight) * rightProgress,
        to.width,
      ),
      easing: readMotionEasing('--motion-spring-soft', 'ease-out'),
    },
    { transform: slideTransform(to.x, toRight, to.width) },
  ];
  return animateWithFallback(element, keyframes, {
    duration: SLIDE_MS,
    easing: 'linear',
  });
}

// 导航目标项下方的指示条：目标变化时以合成层动画滑过去，主线程忙于渲染新页面时也不掉帧
export function useSlidingIndicator<T extends HTMLElement>(
  targetKey: string | undefined,
  { width, memoryKey }: SlidingIndicatorOptions = {},
) {
  const containerRef = useRef<T>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<IndicatorBox | null>(null);
  const boxRef = useRef<IndicatorBox | null>(null);
  const slideFromRef = useRef<Pick<IndicatorBox, 'x' | 'width'> | null>(null);
  // 挂载时读一次上一页的位置；开发模式重复执行副作用时仍从同一起点出发
  const [mountFrom] = useState(() =>
    memoryKey ? (rememberedBoxes.get(memoryKey) ?? null) : null,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = measureTarget(container, width);
    const indicator = indicatorRef.current;
    const from =
      indicator && boxRef.current
        ? toContainerBox(container, indicator.getBoundingClientRect())
        : mountFrom;

    slideFromRef.current =
      next && from && !sameBox({ ...from, top: next.top }, next) ? from : null;
    boxRef.current = next;
    if (memoryKey) {
      if (next) rememberedBoxes.set(memoryKey, next);
      else rememberedBoxes.delete(memoryKey);
    }
    setBox(next);
  }, [targetKey, memoryKey, mountFrom, width]);

  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const from = slideFromRef.current;
    if (!indicator || !box || !from) return;
    const animation = playSlide(indicator, from, box);
    return () => animation?.cancel();
  }, [box]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const next = measureTarget(container, width);
      const current = boxRef.current;
      if (next && current && sameBox(next, current)) return;
      // 尺寸变化直接对齐，不播放滑动
      slideFromRef.current = null;
      boxRef.current = next;
      if (memoryKey) {
        if (next) rememberedBoxes.set(memoryKey, next);
        else rememberedBoxes.delete(memoryKey);
      }
      setBox(next);
    });
    observer.observe(container);
    const target = container.querySelector<HTMLElement>(
      `[${INDICATOR_TARGET_ATTR}]`,
    );
    if (target) observer.observe(target);
    return () => observer.disconnect();
  }, [targetKey, memoryKey, width]);

  const indicatorProps = box
    ? {
        ref: indicatorRef,
        style: {
          width: box.width,
          top: box.top,
          transform: `translateX(${box.x}px)`,
        } satisfies CSSProperties,
      }
    : null;

  return { containerRef, indicatorProps };
}

// 点击导航项后立即把选中态与指示条切过去，不等新页面渲染；路由变化后以实际激活项为准
export function usePendingTarget(activeHref: string | undefined) {
  const [pending, setPending] = useState<{
    href: string;
    from: string | undefined;
  } | null>(null);

  const markPending = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        href === activeHref
      ) {
        return;
      }
      setPending({ href, from: activeHref });
    },
    [activeHref],
  );

  const targetHref =
    pending && pending.from === activeHref ? pending.href : activeHref;
  return { targetHref, markPending };
}
