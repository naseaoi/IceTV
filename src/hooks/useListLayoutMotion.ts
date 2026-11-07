'use client';

import { useLayoutEffect, useRef } from 'react';

import {
  type ContainerOffset,
  animateWithFallback,
  offsetInContainer,
  prefersReducedMotion,
  readMotionEasing,
} from '@/lib/motion-dom';

// 列表项根元素带此属性，值为该项的稳定 key
export const LIST_MOTION_KEY_ATTR = 'data-list-motion-key';
const GHOST_ATTR = 'data-list-motion-ghost';

interface ListLayoutMotionOptions {
  // 子项是无法加属性的组件时，按容器直接子元素的顺序与 keys 一一对应
  matchChildOrder?: boolean;
}

// 增删超过这个数量视为整表替换（清空、翻页、批量加载），直接切换
const MAX_ANIMATED_CHANGES = 8;
const EXIT_MS = 220;
const MOVE_MS = 520;
const MOVE_DELAY_MS = 70;
const ENTER_MS = 320;
const ENTER_DELAY_MS = 180;

interface ItemSnapshot {
  element: HTMLElement;
  offset: ContainerOffset;
}

// 沿定位祖先累加布局偏移：不受进行中的 transform 动画影响，也不随滚动变化
function layoutOffset(
  element: HTMLElement,
  container: HTMLElement,
): ContainerOffset {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && node !== container) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (parent && parent !== container && !container.contains(parent)) break;
    if (parent && parent !== container) {
      x += parent.clientLeft - parent.scrollLeft;
      y += parent.clientTop - parent.scrollTop;
    }
    node = parent;
  }
  if (node !== container) {
    return offsetInContainer(container, element.getBoundingClientRect());
  }
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

function snapshotItems(
  container: HTMLElement,
  keys: readonly string[],
  matchChildOrder: boolean,
) {
  const items = new Map<string, ItemSnapshot>();
  if (matchChildOrder) {
    const children = Array.from(container.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute(GHOST_ATTR),
    );
    if (children.length !== keys.length) return items;
    children.forEach((element, index) => {
      items.set(keys[index], {
        element,
        offset: layoutOffset(element, container),
      });
    });
    return items;
  }
  container
    .querySelectorAll<HTMLElement>(`[${LIST_MOTION_KEY_ATTR}]`)
    .forEach((element) => {
      const key = element.getAttribute(LIST_MOTION_KEY_ATTR);
      if (!key) return;
      items.set(key, { element, offset: layoutOffset(element, container) });
    });
  return items;
}

// React 已把被删项移出文档，原节点放回容器原位置作为残影淡出
function playExit(container: HTMLElement, { element, offset }: ItemSnapshot) {
  const ghost = element;
  ghost.removeAttribute(LIST_MOTION_KEY_ATTR);
  ghost.setAttribute(GHOST_ATTR, '');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${offset.x}px`,
    top: `${offset.y}px`,
    width: `${offset.width}px`,
    height: `${offset.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '0',
  });
  container.appendChild(ghost);
  // 节点重新插入会重播其内部的入场动画，直接跳到终态；无限循环动画（骨架扫光、加载圈）调用 finish 会抛 InvalidStateError
  ghost.getAnimations({ subtree: true }).forEach((animation) => {
    const endTime = animation.effect?.getComputedTiming().endTime;
    if (typeof endTime === 'number' && Number.isFinite(endTime)) {
      animation.finish();
    }
  });
  const animation = ghost.animate(
    [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.88)' },
    ],
    {
      duration: EXIT_MS,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    },
  );
  const removeGhost = () => ghost.remove();
  animation.addEventListener('finish', removeGhost);
  animation.addEventListener('cancel', removeGhost);
}

// 列表增删或重排时：被删项缩小淡出，其余项从原位置弹性滑到新位置，新项随后浮现。
// 容器需为定位元素（relative），残影以它为参照
export function useListLayoutMotion<T extends HTMLElement>(
  keys: readonly string[],
  { matchChildOrder = false }: ListLayoutMotionOptions = {},
) {
  const containerRef = useRef<T>(null);
  const snapshotRef = useRef<Map<string, ItemSnapshot> | null>(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const signature = keys.join('\u0000');

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      snapshotRef.current = null;
      return;
    }
    const previous = snapshotRef.current;
    const next = snapshotItems(container, keysRef.current, matchChildOrder);
    snapshotRef.current = next;
    // 首批数据到达不算增删，入场交给骨架过渡
    if (!previous?.size || typeof container.animate !== 'function') return;
    if (prefersReducedMotion()) return;

    const previousKeys = [...previous.keys()];
    const nextKeys = [...next.keys()];
    const removed = previousKeys.filter((key) => !next.has(key));
    const added = nextKeys.filter((key) => !previous.has(key));
    // 只在末尾追加（加载更多、分批挂载）属于自然延伸，不播放
    const appendOnly =
      removed.length === 0 &&
      previousKeys.every((key, index) => nextKeys[index] === key);
    if (
      appendOnly ||
      removed.length > MAX_ANIMATED_CHANGES ||
      added.length > MAX_ANIMATED_CHANGES
    ) {
      return;
    }

    removed.forEach((key) => {
      const item = previous.get(key);
      if (item && !item.element.isConnected) playExit(container, item);
    });

    const moveEasing = readMotionEasing('--motion-spring-soft', 'ease-out');
    next.forEach(({ element, offset }, key) => {
      const before = previous.get(key);
      if (!before) {
        element.animate(
          [
            { opacity: 0, transform: 'scale(0.94)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          {
            duration: ENTER_MS,
            delay: ENTER_DELAY_MS,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'backwards',
          },
        );
        return;
      }
      const dx = before.offset.x - offset.x;
      const dy = before.offset.y - offset.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      animateWithFallback(
        element,
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0, 0)' },
        ],
        {
          duration: MOVE_MS,
          delay: MOVE_DELAY_MS,
          easing: moveEasing,
          fill: 'backwards',
        },
      );
    });
  }, [signature, matchChildOrder]);

  // 尺寸变化后刷新位置快照，避免下次删除从过期位置起跳；容器可能随列表条件渲染，随 keys 重新挂接
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      snapshotRef.current = snapshotItems(
        container,
        keysRef.current,
        matchChildOrder,
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [signature, matchChildOrder]);

  return containerRef;
}
