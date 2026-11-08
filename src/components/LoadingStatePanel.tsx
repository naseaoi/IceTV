import React from 'react';

import Spinner from '@/components/Spinner';

type Tone = 'brand' | 'neutral' | 'amber' | 'red';

interface LoadingStatePanelProps {
  icon: React.ReactNode;
  // 变化时图标重新播放入场动画，用于加载阶段切换
  iconKey?: string;
  tone?: Tone;
  loading?: boolean;
  title?: string;
  message?: string;
  description?: string;
  progress?: number;
  className?: string;
  children?: React.ReactNode;
}

const TONE_CLASS: Record<Tone, string> = {
  brand:
    'bg-brand-500/10 text-brand-600 dark:bg-brand-400/10 dark:text-brand-300',
  neutral:
    'bg-gray-900/[0.05] text-gray-500 dark:bg-white/[0.06] dark:text-gray-300',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  red: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
};

const LoadingStatePanel: React.FC<LoadingStatePanelProps> = ({
  icon,
  iconKey,
  tone = 'brand',
  loading = false,
  title,
  message,
  description,
  progress,
  className = '',
  children,
}) => {
  const clampedProgress =
    typeof progress === 'number' ? Math.max(0, Math.min(progress, 100)) : null;

  return (
    <div
      className={`flex w-full max-w-sm animate-overlay-in flex-col items-center px-6 text-center ${className}`}
    >
      <div className='relative mb-5 flex h-16 w-16 items-center justify-center sm:h-[72px] sm:w-[72px]'>
        {loading && (
          <Spinner
            className='absolute inset-0 h-full w-full text-brand-500 dark:text-brand-400'
            strokeWidth={2.5}
          />
        )}
        <span
          className={`flex items-center justify-center rounded-full ${
            loading ? 'h-12 w-12 sm:h-14 sm:w-14' : 'h-full w-full'
          } ${TONE_CLASS[tone]}`}
        >
          <span
            key={iconKey}
            className='flex animate-status-icon-in [&>svg]:h-6 [&>svg]:w-6 sm:[&>svg]:h-7 sm:[&>svg]:w-7'
          >
            {icon}
          </span>
        </span>
      </div>

      {title && (
        <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
          {title}
        </h2>
      )}
      {message && (
        <p
          className={
            title
              ? 'mt-1.5 text-sm leading-6 text-gray-500 dark:text-gray-400'
              : 'text-[15px] font-medium text-gray-800 dark:text-gray-100'
          }
        >
          {message}
        </p>
      )}
      {description && (
        <p className='mt-1 text-[13px] leading-5 text-gray-500 dark:text-gray-400'>
          {description}
        </p>
      )}

      {clampedProgress !== null && (
        <div
          role='progressbar'
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clampedProgress)}
          dir='ltr'
          className='mt-5 h-1 w-48 overflow-hidden rounded-full bg-gray-900/[0.06] dark:bg-white/[0.08]'
        >
          <div
            className='loading-bar-fill h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-out dark:bg-brand-400'
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      )}

      {children && <div className='mt-6 w-full'>{children}</div>}
    </div>
  );
};

export default LoadingStatePanel;
