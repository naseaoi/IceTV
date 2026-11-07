export interface ContainerOffset {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 绝对定位以容器内边距盒为参照并随滚动内容移动，需换算到滚动原点
export function offsetInContainer(
  container: HTMLElement,
  rect: DOMRect,
): ContainerOffset {
  const containerRect = container.getBoundingClientRect();
  return {
    x:
      rect.left -
      containerRect.left -
      container.clientLeft +
      container.scrollLeft,
    y: rect.top - containerRect.top - container.clientTop + container.scrollTop,
    width: rect.width,
    height: rect.height,
  };
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 读取 globals.css 里的 --motion-* 缓动；未定义时用 fallback
export function readMotionEasing(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

// linear() 弹簧缓动不受支持时退回 fallback 曲线重新播放
export function animateWithFallback(
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  fallbackEasing = 'ease-out',
) {
  try {
    return element.animate(keyframes, options);
  } catch {
    return element.animate(
      keyframes.map((frame) =>
        frame.easing?.startsWith('linear(')
          ? { ...frame, easing: fallbackEasing }
          : frame,
      ),
      options.easing?.startsWith('linear(')
        ? { ...options, easing: fallbackEasing }
        : options,
    );
  }
}
