import { Radio } from 'lucide-react';
import { type TouchEvent, useEffect, useRef, useState } from 'react';

import type { CardAction } from '@/components/card-actions/actions';
import CardActionList from '@/components/card-actions/CardActionList';
import CoverImage from '@/components/CoverImage';
import { useBodyScrollLock } from '@/components/user-menu/useBodyScrollLock';

const SWIPE_CLOSE_DISTANCE = 80;

interface CardActionSheetProps {
  shown: boolean;
  title: string;
  subtitle?: string;
  poster?: string;
  live?: boolean;
  actions: CardAction[];
  onAction: (action: CardAction) => void;
  onClose: () => void;
}

export default function CardActionSheet({
  shown,
  title,
  subtitle,
  poster,
  live,
  actions,
  onAction,
  onClose,
}: CardActionSheetProps) {
  const onCloseRef = useRef(onClose);
  const swipeStartRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useBodyScrollLock(true);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 下滑手势只挂在拖拽条与头部，操作列表的点按不受影响
  const swipeHandlers = {
    onTouchStart: (event: TouchEvent) => {
      swipeStartRef.current = event.touches[0].clientY;
    },
    onTouchMove: (event: TouchEvent) => {
      if (swipeStartRef.current === null) return;
      setDragOffset(
        Math.max(0, event.touches[0].clientY - swipeStartRef.current),
      );
    },
    onTouchEnd: () => {
      swipeStartRef.current = null;
      if (dragOffset > SWIPE_CLOSE_DISTANCE) onClose();
      setDragOffset(0);
    },
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-end justify-center ${
        shown ? '' : 'pointer-events-none'
      }`}
    >
      <div
        aria-hidden='true'
        className={`absolute inset-0 touch-none bg-black/50 transition-opacity duration-200 ease-out ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        role='menu'
        aria-label={title}
        className={`relative w-full max-w-lg select-none overscroll-contain rounded-t-2xl bg-white ring-1 ring-gray-900/[0.06] ease-out dark:bg-gray-900 dark:ring-white/[0.06] sm:mb-4 sm:rounded-2xl ${
          dragOffset > 0 ? '' : 'transition-transform duration-200'
        }`}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          transform: shown ? `translateY(${dragOffset}px)` : 'translateY(100%)',
        }}
      >
        <div className='touch-none' {...swipeHandlers}>
          <div className='mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600' />
          <div className='flex items-center gap-3 px-4 pb-3 pt-3'>
            <div className='relative h-[60px] w-11 shrink-0 overflow-hidden rounded-md bg-gray-100 ring-1 ring-gray-900/[0.06] dark:bg-gray-800 dark:ring-white/[0.06]'>
              <CoverImage
                src={poster || ''}
                alt={title}
                fit={live ? 'contain' : 'cover'}
                sizes='44px'
              />
            </div>
            <div className='min-w-0 flex-1'>
              <h3 className='truncate text-base font-semibold text-gray-900 dark:text-gray-100'>
                {title}
              </h3>
              {subtitle && (
                <p className='mt-0.5 flex min-w-0 items-center gap-1 text-[13px] text-gray-500 dark:text-gray-400'>
                  {live && <Radio aria-hidden='true' className='h-3 w-3' />}
                  <span className='truncate'>{subtitle}</span>
                </p>
              )}
            </div>
          </div>
        </div>
        <div className='mx-4 h-px bg-gray-900/[0.06] dark:bg-white/[0.06]' />
        <div className='p-2 pb-3'>
          <CardActionList
            actions={actions}
            variant='sheet'
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  );
}
