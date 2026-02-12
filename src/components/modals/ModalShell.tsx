'use client';

import { type ReactNode, useEffect, useState } from 'react';
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

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      requestAnimationFrame(() => {
        setVisible(true);
      });
      return;
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
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={() => {
        if (closeOnBackdrop) {
          onClose();
        }
      }}
      role='presentation'
    >
      <div
        className={`w-full transform rounded-2xl border border-slate-200/70 bg-white shadow-2xl transition-all duration-200 dark:border-slate-700 dark:bg-slate-900 ${
          visible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
        } ${panelClassName || ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
