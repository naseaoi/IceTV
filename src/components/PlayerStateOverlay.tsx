'use client';

import { ReactNode, useEffect, useState } from 'react';

import Spinner from '@/components/Spinner';

type Tone = 'red' | 'amber' | 'neutral';

interface PlayerStateOverlayProps {
  title: string;
  message?: string;
  zClassName: string;
  // 加载态只显示环形指示与状态文字；否则为带图标的提示卡
  loading?: boolean;
  icon?: ReactNode;
  tone?: Tone;
  // 为 false 时淡出后卸载，调用方需在淡出期间保持内容可渲染
  visible?: boolean;
  // 不拦截点击与手势，让下层播放器照常响应
  passThrough?: boolean;
  children?: ReactNode;
}

const EXIT_DURATION_MS = 220;

const TONE_CLASS: Record<Tone, string> = {
  red: 'bg-rose-500/15 text-rose-300',
  amber: 'bg-amber-500/15 text-amber-300',
  neutral: 'bg-white/10 text-white/80',
};

export const PLAYER_OVERLAY_PRIMARY_BUTTON_CLASS =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-xs font-medium text-gray-900 transition-colors hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:h-9 sm:text-sm';

export const PLAYER_OVERLAY_SECONDARY_BUTTON_CLASS =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-white/10 px-4 text-xs font-medium text-white/85 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:h-9 sm:text-sm';

function usePresence(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) return;
    const timer = window.setTimeout(() => setMounted(false), EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return mounted;
}

export default function PlayerStateOverlay({
  title,
  message,
  zClassName,
  loading = false,
  icon,
  tone = 'red',
  visible = true,
  passThrough = false,
  children,
}: PlayerStateOverlayProps) {
  const mounted = usePresence(visible);
  if (!mounted) return null;

  return (
    <div
      data-player-overlay
      aria-hidden={!visible || undefined}
      className={`absolute inset-0 ${zClassName} flex items-center justify-center overflow-hidden transition-opacity duration-200 ease-out md:rounded-xl ${
        loading ? 'bg-black/80' : 'bg-black/85'
      } ${visible ? 'animate-overlay-in opacity-100' : 'opacity-0'} ${
        passThrough || !visible ? 'pointer-events-none' : ''
      }`}
    >
      {loading ? (
        <div
          role='status'
          className='flex flex-col items-center gap-2.5 px-4 text-center sm:gap-3.5'
        >
          <Spinner
            className='h-8 w-8 text-brand-300 sm:h-11 sm:w-11'
            strokeWidth={3.5}
          />
          <div>
            <p className='text-[13px] font-medium text-white/90 sm:text-sm'>
              {title}
            </p>
            {message && (
              <p className='mt-0.5 text-xs tabular-nums text-white/55'>
                {message}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className='flex w-full max-w-[18rem] flex-col items-center px-4 text-center sm:max-w-sm'>
          {icon && (
            <span
              className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full sm:mb-3 sm:h-12 sm:w-12 [&>svg]:h-[18px] [&>svg]:w-[18px] sm:[&>svg]:h-6 sm:[&>svg]:w-6 ${TONE_CLASS[tone]}`}
            >
              {icon}
            </span>
          )}
          <p className='text-sm font-semibold text-white sm:text-base'>
            {title}
          </p>
          {message && (
            <p className='mt-1 line-clamp-2 text-xs leading-5 text-white/60 sm:text-[13px]'>
              {message}
            </p>
          )}
          {children && (
            <div className='mt-3 flex flex-wrap items-center justify-center gap-2 sm:mt-4'>
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
