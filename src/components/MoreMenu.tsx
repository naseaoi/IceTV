'use client';

import { type LucideIcon, MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { usePresence } from '@/hooks/usePresence';
import { snapToDevicePixel } from '@/lib/pixel-snap';

export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
}

interface MoreMenuProps {
  label: string;
  items: MoreMenuItem[];
  triggerClassName?: string;
}

const MENU_GAP = 4;
const VIEWPORT_GAP = 8;
const MENU_EXIT_MS = 200;

const DEFAULT_TRIGGER_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 aria-expanded:bg-gray-100 aria-expanded:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100 dark:aria-expanded:bg-white/[0.08] dark:aria-expanded:text-gray-100';

// 滚动容器会裁切绝对定位的菜单，所以挂到 body 上按触发器定位，右对齐触发器，下方放不下时向上展开
export default function MoreMenu({
  label,
  items,
  triggerClassName = DEFAULT_TRIGGER_CLASS,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open, MENU_EXIT_MS);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !presence.mounted) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const below = rect.bottom + MENU_GAP;
    const openUp =
      below + menu.offsetHeight > window.innerHeight - VIEWPORT_GAP;
    const top = openUp
      ? Math.max(VIEWPORT_GAP, rect.top - MENU_GAP - menu.offsetHeight)
      : below;
    const left = Math.min(
      Math.max(VIEWPORT_GAP, rect.right - menu.offsetWidth),
      window.innerWidth - menu.offsetWidth - VIEWPORT_GAP,
    );
    menu.style.top = `${snapToDevicePixel(top)}px`;
    menu.style.left = `${snapToDevicePixel(left)}px`;
    menu.style.setProperty(
      '--popover-origin',
      `${openUp ? 'bottom' : 'top'} right`,
    );
    menu.style.setProperty('--popover-shift', openUp ? '6px' : '-6px');
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open, presence.mounted]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      )
        close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 菜单开着时 Esc 只关菜单，不连带关闭外层弹窗
      event.stopImmediatePropagation();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        aria-label={label}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={triggerClassName}
      >
        <MoreHorizontal aria-hidden='true' className='h-4 w-4' />
      </button>
      {presence.mounted &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role='menu'
            aria-label={label}
            data-open={presence.visible}
            className='motion-popover fixed left-0 top-0 z-[10000] w-max rounded-xl bg-white p-1 shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.08] dark:bg-gray-900 dark:shadow-black/40 dark:ring-white/10'
          >
            {items.map(({ label: itemLabel, icon: Icon, ...item }) => (
              <button
                key={itemLabel}
                type='button'
                role='menuitem'
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 text-left text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.danger
                    ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 dark:focus-visible:bg-red-500/10'
                    : 'text-gray-700 hover:bg-gray-100 focus-visible:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]'
                }`}
              >
                {Icon && (
                  <Icon aria-hidden='true' className='h-3.5 w-3.5 shrink-0' />
                )}
                {itemLabel}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
