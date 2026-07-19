'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
  closeOnBackdrop?: boolean;
}

const CLOSE_ANIMATION_MS = 220;

export default function ModalShell({
  isOpen,
  onClose,
  children,
  panelClassName,
  closeOnBackdrop = true,
}: ModalShellProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  // 冻结 children 快照：关闭动画期间仍显示关闭前的内容，
  // 避免调用方同步清空数据导致"文字先消失、面板后淡出"的视觉割裂。
  const childrenSnapshot = useRef<ReactNode>(children);
  if (isOpen) {
    childrenSnapshot.current = children;
  }

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      // 双重 rAF：等 opacity-0 完成首帧绘制后再触发入场过渡
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          setVisible(true);
        });
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
      };
    }

    setVisible(false);
    const timeout = window.setTimeout(() => {
      setMounted(false);
    }, CLOSE_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isOpen]);

  useEffect(() => {
    if (mounted && overlayRef.current) {
      overlayRef.current.focus();
    }
  }, [mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mounted, onClose]);

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
        className={`w-full transform rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl transition-[opacity,transform] duration-200 dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10 ${
          visible
            ? 'translate-y-0 scale-100 opacity-100'
            : 'translate-y-2 scale-95 opacity-0'
        } ${panelClassName || ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        {childrenSnapshot.current}
      </div>
    </div>,
    document.body,
  );
}
