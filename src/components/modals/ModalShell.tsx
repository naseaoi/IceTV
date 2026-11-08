'use client';

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { useBodyScrollLock } from '@/components/user-menu/useBodyScrollLock';
import { usePresence } from '@/hooks/usePresence';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
  closeOnBackdrop?: boolean;
  // 遮罩层底色，默认半透明黑
  backdropClassName?: string;
  // 打开后聚焦的元素，默认聚焦遮罩层
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const CLOSE_ANIMATION_MS = 130;

// 叠放的弹窗按打开顺序入栈，Esc 只关闭最上层
const openShells: symbol[] = [];

// 不经 ModalShell 的自绘浮层用它避让 Esc，让叠在上面的弹窗先关闭
export function hasOpenModalShell() {
  return openShells.length > 0;
}

// 打开时才挂载的弹窗（父组件条件渲染、按需加载）用它代替直接关闭：
// 先播放退场，结束后再通知父组件卸载
export function useDeferredClose(onClose: () => void) {
  const [open, setOpen] = useState(true);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (open) return;
    const timeout = window.setTimeout(
      () => onCloseRef.current(),
      CLOSE_ANIMATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [open]);

  const requestClose = useCallback(() => setOpen(false), []);
  return [open, requestClose] as const;
}

export default function ModalShell({
  isOpen,
  onClose,
  children,
  panelClassName,
  closeOnBackdrop = true,
  backdropClassName = 'bg-black/50',
  initialFocusRef,
}: ModalShellProps) {
  const { mounted, visible } = usePresence(isOpen, CLOSE_ANIMATION_MS);
  const overlayRef = useRef<HTMLDivElement>(null);
  // 冻结 children 快照：关闭动画期间仍显示关闭前的内容，
  // 避免调用方同步清空数据导致"文字先消失、面板后淡出"的视觉割裂。
  const childrenSnapshot = useRef<ReactNode>(children);
  if (isOpen) {
    childrenSnapshot.current = children;
  }

  useBodyScrollLock(mounted);

  useEffect(() => {
    if (!mounted) return;
    (initialFocusRef?.current ?? overlayRef.current)?.focus();
  }, [mounted, initialFocusRef]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const id = Symbol('modal');
    openShells.push(id);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openShells.at(-1) !== id) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      openShells.splice(openShells.indexOf(id), 1);
    };
  }, [isOpen]);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      ref={overlayRef}
      tabIndex={-1}
      className='fixed inset-0 z-[9999] flex items-center justify-center p-4 outline-none'
      onClick={() => {
        if (closeOnBackdrop) {
          onClose();
        }
      }}
      role='presentation'
    >
      <div
        aria-hidden='true'
        data-open={visible}
        className={`motion-backdrop absolute inset-0 ${backdropClassName}`}
      />
      <div
        data-open={visible}
        className={`motion-dialog relative w-full rounded-2xl bg-white shadow-2xl shadow-black/10 ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/50 dark:ring-white/[0.08] ${panelClassName || ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        {childrenSnapshot.current}
      </div>
    </div>,
    document.body,
  );
}
