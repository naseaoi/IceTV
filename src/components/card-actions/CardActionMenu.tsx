import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type {
  CardAction,
  CardActionAnchor,
} from '@/components/card-actions/actions';
import CardActionList from '@/components/card-actions/CardActionList';

const VIEWPORT_PADDING = 8;
const BUTTON_GAP = 4;

type MenuPlacement = { top: number; left: number; origin: string };

// 光标点向右下展开，按钮矩形则右对齐到按钮下方；越界时翻转
function placeMenu(
  anchor: CardActionAnchor,
  width: number,
  height: number,
): MenuPlacement {
  const isPoint = anchor.width === 0 && anchor.height === 0;
  const gap = isPoint ? 0 : BUTTON_GAP;
  const maxLeft = window.innerWidth - width - VIEWPORT_PADDING;
  const maxTop = window.innerHeight - height - VIEWPORT_PADDING;

  let left = isPoint ? anchor.left : anchor.left + anchor.width - width;
  let alignRight = !isPoint;
  if (isPoint && left > maxLeft) {
    left = anchor.left - width;
    alignRight = true;
  } else if (!isPoint && left < VIEWPORT_PADDING) {
    left = anchor.left;
    alignRight = false;
  }

  let top = anchor.top + anchor.height + gap;
  let above = false;
  if (top > maxTop) {
    top = anchor.top - gap - height;
    above = true;
  }

  return {
    top: Math.max(VIEWPORT_PADDING, Math.min(top, maxTop)),
    left: Math.max(VIEWPORT_PADDING, Math.min(left, maxLeft)),
    origin: `${above ? 'bottom' : 'top'} ${alignRight ? 'right' : 'left'}`,
  };
}

function getMenuItems(panel: HTMLElement) {
  return Array.from(
    panel.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled])',
    ),
  );
}

interface CardActionMenuProps {
  shown: boolean;
  anchor: CardActionAnchor;
  title: string;
  footer?: string;
  actions: CardAction[];
  onAction: (action: CardAction) => void;
  onClose: () => void;
}

export default function CardActionMenu({
  shown,
  anchor,
  title,
  footer,
  actions,
  onAction,
  onClose,
}: CardActionMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    setPlacement(placeMenu(anchor, panel.offsetWidth, panel.offsetHeight));
  }, [anchor, actions.length, footer]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    getMenuItems(panel)[0]?.focus({ preventScroll: true });

    const isOutside = (event: Event) =>
      !panel.contains(event.target as Node | null);
    const closeIfOutside = (event: Event) => {
      if (isOutside(event)) onCloseRef.current();
    };
    const close = () => onCloseRef.current();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        close();
        return;
      }

      const items = getMenuItems(panel);
      if (items.length === 0) return;
      const current = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === 'ArrowDown'
          ? (current + 1) % items.length
          : event.key === 'ArrowUp'
            ? (current - 1 + items.length) % items.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : -1;
      if (next < 0) return;
      event.preventDefault();
      items[next].focus();
    };

    document.addEventListener('mousedown', closeIfOutside, true);
    document.addEventListener('contextmenu', closeIfOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', closeIfOutside, true);
    window.addEventListener('wheel', closeIfOutside, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);

    return () => {
      document.removeEventListener('mousedown', closeIfOutside, true);
      document.removeEventListener('contextmenu', closeIfOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', closeIfOutside, true);
      window.removeEventListener('wheel', closeIfOutside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      // 焦点随菜单卸载丢失时还给触发元素，点击别处时不抢焦点
      if (!document.activeElement || document.activeElement === document.body) {
        previousFocus?.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <div className='pointer-events-none fixed inset-0 z-[9999]'>
      <div
        ref={panelRef}
        role='menu'
        aria-label={title}
        className={`absolute w-52 select-none rounded-xl bg-white p-1 shadow-2xl shadow-black/10 ring-1 ring-gray-900/[0.08] transition-[opacity,transform] duration-150 ease-out dark:bg-gray-900 dark:shadow-black/50 dark:ring-white/[0.08] ${
          shown && placement
            ? 'pointer-events-auto scale-100 opacity-100'
            : 'scale-95 opacity-0'
        }`}
        style={{
          top: placement?.top ?? anchor.top,
          left: placement?.left ?? anchor.left,
          transformOrigin: placement?.origin,
          visibility: placement ? undefined : 'hidden',
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <p className='truncate px-2.5 pb-1 pt-1.5 text-xs font-medium text-gray-500 dark:text-gray-400'>
          {title}
        </p>
        <CardActionList actions={actions} variant='menu' onAction={onAction} />
        {footer && (
          <>
            <div className='mx-1.5 my-1 h-px bg-gray-900/[0.06] dark:bg-white/[0.06]' />
            <p className='truncate px-2.5 pb-1.5 pt-1 text-xs text-gray-400 dark:text-gray-500'>
              {footer}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
