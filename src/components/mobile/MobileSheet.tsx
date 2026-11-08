'use client';

import { X } from 'lucide-react';
import { ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { useBodyScrollLock } from '@/components/user-menu/useBodyScrollLock';
import { usePresence } from '@/hooks/usePresence';

interface MobileSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const SHEET_EXIT_MS = 300;

export default function MobileSheet({
  open,
  title,
  onClose,
  children,
  footer,
}: MobileSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const { mounted, visible } = usePresence(open, SHEET_EXIT_MS);
  // 收起动画期间保留关闭前的内容，避免调用方清空数据后面板先变空再滑走
  const snapshot = useRef({ title, children, footer });
  if (open) {
    snapshot.current = { title, children, footer };
  }

  useBodyScrollLock(open);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const desktopQuery = window.matchMedia('(min-width: 768px)');

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);

      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const handleDesktopChange = () => {
      if (desktopQuery.matches) {
        onCloseRef.current();
      }
    };

    const frameId = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    document.addEventListener('keydown', handleKeyDown);
    desktopQuery.addEventListener('change', handleDesktopChange);
    handleDesktopChange();

    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      desktopQuery.removeEventListener('change', handleDesktopChange);
      previousFocus?.focus();
    };
  }, [open]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[1200] md:hidden ${open ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 motion-reduce:transition-none ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden='true'
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-2xl bg-white outline-none transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none dark:bg-gray-900 ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className='mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600' />
        <div className='flex shrink-0 items-center justify-between px-4 py-3'>
          <h3
            id={titleId}
            className='text-base font-semibold text-gray-900 dark:text-gray-100'
          >
            {snapshot.current.title}
          </h3>
          <button
            ref={closeButtonRef}
            type='button'
            aria-label='关闭'
            className='flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            onClick={onClose}
          >
            <X className='h-5 w-5' />
          </button>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-4 pb-4'>
          {snapshot.current.children}
        </div>
        {snapshot.current.footer && (
          <div className='shrink-0 border-t border-gray-200 px-4 py-3 dark:border-gray-700'>
            {snapshot.current.footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
