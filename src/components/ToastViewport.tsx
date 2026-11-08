'use client';

import { Bell, X } from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  type ToastAction,
  type ToastDetail,
  type ToastTone,
  TOAST_DISMISS_EVENT,
  TOAST_EVENT,
} from '@/lib/toast';

const MAX_TOASTS = 3;
const TOAST_GAP = 10;
// 与 globals.css 中 toast-vanish 的延迟 + 时长一致
export const TOAST_LEAVE_MS = 440;
const SWIPE_DISMISS_DISTANCE = 28;
const SWIPE_DISMISS_VELOCITY = 0.45;
const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 2600,
  info: 3200,
  notice: 6000,
  error: 5000,
};
const HEAD_TONE_CLASS: Record<ToastTone, string> = {
  success:
    'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
  error: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  info: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300',
  notice: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
};

interface ToastItem {
  id: number;
  key: string;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  duration: number;
  bump: number;
  leaving: boolean;
}

function drawStyle(delay: number, duration?: number): CSSProperties {
  return {
    '--toast-draw-delay': `${delay}ms`,
    ...(duration ? { '--toast-draw-duration': `${duration}ms` } : {}),
  } as CSSProperties;
}

function ToastGlyph({ tone }: { tone: ToastTone }) {
  if (tone === 'notice') {
    return <Bell aria-hidden className='toast-bell h-4 w-4' />;
  }
  return (
    <svg
      aria-hidden
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2.2}
      strokeLinecap='round'
      strokeLinejoin='round'
      className='h-[18px] w-[18px]'
    >
      <circle
        cx='12'
        cy='12'
        r='9'
        pathLength={1}
        className='toast-draw'
        style={drawStyle(80, 420)}
      />
      {tone === 'success' && (
        <path
          d='M8.2 12.4l2.6 2.6 5-5.4'
          pathLength={1}
          className='toast-draw'
          style={drawStyle(380, 280)}
        />
      )}
      {tone === 'error' && (
        <>
          <path
            d='M12 7.6v5.2'
            pathLength={1}
            className='toast-draw'
            style={drawStyle(360, 220)}
          />
          <path d='M12 16.4h.01' className='toast-dot' style={drawStyle(520)} />
        </>
      )}
      {tone === 'info' && (
        <>
          <path d='M12 7.8h.01' className='toast-dot' style={drawStyle(340)} />
          <path
            d='M12 11.2v5'
            pathLength={1}
            className='toast-draw'
            style={drawStyle(420, 220)}
          />
        </>
      )}
    </svg>
  );
}

function ToastCard({
  toast,
  offset,
  paused,
  onDismiss,
  onHeight,
}: {
  toast: ToastItem;
  offset: number;
  paused: boolean;
  onDismiss: (id: number) => void;
  onHeight: (id: number, height: number) => void;
}) {
  const slotRef = useRef<HTMLLIElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const remainingRef = useRef(toast.duration);
  const dragRef = useRef<{ startY: number; startTime: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const { id, bump, duration, leaving } = toast;

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const surface = surfaceRef.current;
    if (!slot || !surface) return;
    const measure = () => {
      surface.style.setProperty('--toast-w', `${surface.offsetWidth}px`);
      onHeight(id, slot.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [id, onHeight]);

  useEffect(() => {
    remainingRef.current = duration;
  }, [bump, duration]);

  useEffect(() => {
    if (paused || leaving || dragging) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(id), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      // 暂停后至少留一点时间，避免移开指针瞬间消失
      remainingRef.current = Math.max(
        800,
        remainingRef.current - (Date.now() - startedAt),
      );
    };
  }, [bump, dragging, id, leaving, onDismiss, paused]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLLIElement>) => {
    if (leaving || (event.target as HTMLElement).closest('button')) return;
    dragRef.current = { startY: event.clientY, startTime: Date.now() };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLLIElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const delta = event.clientY - start.startY;
    // 向上跟手，向下带阻尼
    setDrag(delta < 0 ? delta : delta * 0.2);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLLIElement>) => {
    const start = dragRef.current;
    if (!start) return;
    dragRef.current = null;
    setDragging(false);
    const delta = event.clientY - start.startY;
    const velocity = delta / Math.max(1, Date.now() - start.startTime);
    if (delta < -SWIPE_DISMISS_DISTANCE || velocity < -SWIPE_DISMISS_VELOCITY) {
      onDismiss(id);
      return;
    }
    setDrag(0);
  };

  const phase = leaving ? 'leave' : 'idle';
  const closable = toast.tone === 'error' || toast.tone === 'notice';
  const hasTrailing = closable || !!toast.action;

  return (
    <li
      ref={slotRef}
      className='toast-slot'
      style={{ '--toast-y': `${offset}px` } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div
        className='toast-shadow'
        data-dragging={dragging}
        style={{ '--toast-drag': `${drag}px` } as CSSProperties}
      >
        <div
          className='toast-motion'
          data-phase={phase}
          data-bump={bump === 0 ? undefined : bump % 2 ? 'a' : 'b'}
        >
          <div
            ref={surfaceRef}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            data-tone={toast.tone}
            data-phase={phase}
            className={`toast-surface flex items-center gap-2.5 rounded-[1.375rem] border border-gray-900/[0.06] bg-white py-1.5 pl-1.5 text-sm font-medium leading-5 text-gray-800 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100 ${
              hasTrailing ? 'pr-1.5' : 'pr-4'
            }`}
          >
            <span
              key={`head-${bump}`}
              data-tone={toast.tone}
              className={`toast-head flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${HEAD_TONE_CLASS[toast.tone]}`}
            >
              <ToastGlyph tone={toast.tone} />
            </span>
            <div
              key={`content-${toast.message}`}
              data-phase={phase}
              className='toast-content flex min-w-0 items-center gap-1.5'
              style={
                bump > 0
                  ? ({ '--toast-content-delay': '0ms' } as CSSProperties)
                  : undefined
              }
            >
              <span className='min-w-0 max-w-[min(22rem,calc(100vw-8rem))] py-1'>
                {toast.message}
              </span>
              {toast.action && (
                <button
                  type='button'
                  className='ml-1 inline-flex h-7 shrink-0 items-center rounded-full bg-brand-50 px-3 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25'
                  onClick={() => {
                    toast.action?.onClick();
                    onDismiss(id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              {closable && (
                <button
                  type='button'
                  aria-label='关闭提示'
                  title='关闭'
                  className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200'
                  onClick={() => onDismiss(id)}
                >
                  <X className='h-3.5 w-3.5' />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function ToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);
  const toastsRef = useRef(toasts);
  const nextIdRef = useRef(0);
  const removeTimersRef = useRef(new Map<number, number>());

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const dismiss = useCallback((id: number) => {
    if (removeTimersRef.current.has(id)) return;
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id ? { ...toast, leaving: true } : toast,
      ),
    );
    removeTimersRef.current.set(
      id,
      window.setTimeout(() => {
        removeTimersRef.current.delete(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
        setHeights(({ [id]: _removed, ...rest }) => rest);
      }, TOAST_LEAVE_MS),
    );
  }, []);

  const handleHeight = useCallback((id: number, height: number) => {
    setHeights((current) =>
      current[id] === height ? current : { ...current, [id]: height },
    );
  }, []);

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      const duration = detail.duration ?? DEFAULT_DURATION[detail.tone];
      setToasts((current) => {
        const existing = current.find(
          (toast) => toast.key === detail.key && !toast.leaving,
        );
        if (existing) {
          return current.map((toast) =>
            toast === existing
              ? {
                  ...toast,
                  message: detail.message,
                  tone: detail.tone,
                  action: detail.action,
                  duration,
                  bump: toast.bump + 1,
                }
              : toast,
          );
        }
        return [
          {
            id: ++nextIdRef.current,
            key: detail.key,
            message: detail.message,
            tone: detail.tone,
            action: detail.action,
            duration,
            bump: 0,
            leaving: false,
          },
          ...current,
        ];
      });
    };
    const handleDismiss = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      toastsRef.current
        .filter((toast) => toast.key === key && !toast.leaving)
        .forEach((toast) => dismiss(toast.id));
    };
    const handleVisibility = () => setHidden(document.hidden);
    window.addEventListener(TOAST_EVENT, handleToast);
    window.addEventListener(TOAST_DISMISS_EVENT, handleDismiss);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener(TOAST_EVENT, handleToast);
      window.removeEventListener(TOAST_DISMISS_EVENT, handleDismiss);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dismiss]);

  useEffect(() => {
    toasts
      .filter((toast) => !toast.leaving)
      .slice(MAX_TOASTS)
      .forEach((toast) => dismiss(toast.id));
  }, [dismiss, toasts]);

  useEffect(() => {
    const timers = removeTimersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  let offset = 0;
  const offsets = toasts.map((toast) => {
    const current = offset;
    if (!toast.leaving) offset += (heights[toast.id] ?? 0) + TOAST_GAP;
    return current;
  });

  return (
    <section
      aria-label='通知'
      aria-live='polite'
      className='pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.75rem)] z-[2000]'
    >
      <ol
        className='relative'
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {toasts.map((toast, index) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            offset={offsets[index]}
            paused={hovered || hidden}
            onDismiss={dismiss}
            onHeight={handleHeight}
          />
        ))}
      </ol>
    </section>
  );
}
