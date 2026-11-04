'use client';

import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface AdminRowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface AdminRowMenuProps {
  label: string;
  items: AdminRowMenuItem[];
}

const MENU_WIDTH = 160;
const VIEWPORT_GAP = 8;

// 表格容器横向可滚动会裁切绝对定位的菜单，所以挂到 body 上按触发器定位
export default function AdminRowMenu({ label, items }: AdminRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const below = rect.bottom + 4;
    const top =
      below + menuHeight > window.innerHeight - VIEWPORT_GAP
        ? Math.max(VIEWPORT_GAP, rect.top - 4 - menuHeight)
        : below;
    const left = Math.min(
      Math.max(VIEWPORT_GAP, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - VIEWPORT_GAP,
    );
    setPosition({ top, left });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);

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
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
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
        className='inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 aria-expanded:bg-gray-100 aria-expanded:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100 dark:aria-expanded:bg-white/[0.08] dark:aria-expanded:text-gray-100'
      >
        <MoreHorizontal aria-hidden='true' className='h-4 w-4' />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role='menu'
            aria-label={label}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: MENU_WIDTH,
              visibility: position ? 'visible' : 'hidden',
            }}
            className='fixed z-[1000] rounded-xl bg-white p-1 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-white/10'
          >
            {items.map((item) => (
              <button
                key={item.label}
                type='button'
                role='menuitem'
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex h-8 w-full items-center rounded-lg px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.danger
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
