import React from 'react';

type Tone = 'emerald' | 'blue' | 'amber' | 'red';

type StepItem = {
  label: string;
  status: 'pending' | 'active' | 'done';
};

interface LoadingStatePanelProps {
  icon: React.ReactNode;
  title: string;
  titleClassName?: string;
  message?: string;
  messageClassName?: string;
  description?: string;
  descriptionClassName?: string;
  tone?: Tone;
  progress?: number;
  steps?: StepItem[];
  compact?: boolean;
  className?: string;
  glow?: boolean;
  children?: React.ReactNode;
}

const toneMap: Record<
  Tone,
  {
    halo: string;
    iconTone: string;
    text: string;
    mutedText: string;
    stepActive: string;
    stepDone: string;
    stepPending: string;
    track: string;
    fill: string;
  }
> = {
  emerald: {
    halo: 'from-emerald-500/25 via-green-500/10 to-transparent',
    iconTone: 'text-emerald-500 dark:text-emerald-300',
    text: 'text-gray-900 dark:text-gray-100',
    mutedText: 'text-gray-600 dark:text-gray-300',
    stepActive: 'bg-emerald-500 scale-125 shadow-lg shadow-emerald-500/40',
    stepDone: 'bg-emerald-500/90',
    stepPending: 'bg-gray-300 dark:bg-gray-600',
    track: 'bg-gray-200/90 dark:bg-gray-700/80',
    fill: 'from-emerald-500 via-green-500 to-emerald-400',
  },
  blue: {
    halo: 'from-sky-500/25 via-blue-500/10 to-transparent',
    iconTone: 'text-sky-500 dark:text-sky-300',
    text: 'text-gray-900 dark:text-gray-100',
    mutedText: 'text-gray-600 dark:text-gray-300',
    stepActive: 'bg-sky-500 scale-125 shadow-lg shadow-sky-500/40',
    stepDone: 'bg-sky-500/90',
    stepPending: 'bg-gray-300 dark:bg-gray-600',
    track: 'bg-gray-200/90 dark:bg-gray-700/80',
    fill: 'from-sky-500 via-blue-500 to-cyan-400',
  },
  amber: {
    halo: 'from-amber-500/25 via-orange-500/10 to-transparent',
    iconTone: 'text-amber-500 dark:text-amber-300',
    text: 'text-gray-900 dark:text-gray-100',
    mutedText: 'text-gray-600 dark:text-gray-300',
    stepActive: 'bg-amber-500 scale-125 shadow-lg shadow-amber-500/40',
    stepDone: 'bg-amber-500/90',
    stepPending: 'bg-gray-300 dark:bg-gray-600',
    track: 'bg-gray-200/90 dark:bg-gray-700/80',
    fill: 'from-amber-500 via-orange-500 to-yellow-400',
  },
  red: {
    halo: 'from-red-500/25 via-rose-500/10 to-transparent',
    iconTone: 'text-red-500 dark:text-red-300',
    text: 'text-gray-900 dark:text-gray-100',
    mutedText: 'text-gray-600 dark:text-gray-300',
    stepActive: 'bg-red-500 scale-125 shadow-lg shadow-red-500/40',
    stepDone: 'bg-red-500/90',
    stepPending: 'bg-gray-300 dark:bg-gray-600',
    track: 'bg-gray-200/90 dark:bg-gray-700/80',
    fill: 'from-red-500 via-rose-500 to-orange-400',
  },
};

const LoadingStatePanel: React.FC<LoadingStatePanelProps> = ({
  icon,
  title,
  titleClassName,
  message,
  messageClassName,
  description,
  descriptionClassName,
  tone = 'emerald',
  progress,
  steps,
  compact = false,
  className = '',
  glow = false,
  children,
}) => {
  const colors = toneMap[tone];

  return (
    <div
      className={`relative overflow-visible ${
        compact ? 'w-full max-w-lg p-6' : 'w-full max-w-2xl p-8 md:p-10'
      } ${className}`}
    >
      <div
        className={`pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-gradient-to-br ${colors.halo} blur-2xl`}
      />
      <div className='pointer-events-none absolute -bottom-24 -right-16 h-52 w-52 rounded-full bg-white/20 blur-2xl dark:bg-white/5' />

      <div className='relative flex flex-col items-center text-center'>
        <div className='relative mb-7'>
          <div className='relative z-[2] mx-auto h-24 w-24'>
            {glow && (
              <div
                className={`ls-glow-ring absolute -inset-1 rounded-full ${colors.iconTone}`}
              />
            )}
            <div
              className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br ${colors.halo} ${colors.iconTone}`}
            >
              {icon}
            </div>
          </div>
        </div>

        <h3
          className={`text-2xl font-semibold tracking-tight ${colors.text} ${titleClassName || ''}`}
        >
          {title}
        </h3>
        {message && (
          <p
            className={`mt-2 text-base font-medium ${colors.mutedText} ${messageClassName || ''}`}
          >
            {message}
          </p>
        )}
        {description && (
          <p
            className={`mt-2 text-sm leading-6 ${colors.mutedText} ${descriptionClassName || ''}`}
          >
            {description}
          </p>
        )}

        {typeof progress === 'number' && (
          <div
            className='mx-auto mt-6 w-full max-w-[22rem] self-stretch'
            dir='ltr'
          >
            <div
              className={`relative h-2.5 overflow-hidden rounded-full ${colors.track}`}
            >
              <div
                className={`ls-shimmer absolute left-0 top-0 h-full rounded-full bg-gradient-to-r ${colors.fill} transition-all duration-700 ease-out`}
                style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
              />
            </div>
          </div>
        )}

        {steps && steps.length > 0 && (
          <div className='mt-5 flex items-center justify-center gap-3'>
            {steps.map((step) => (
              <div
                key={step.label}
                className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
                  step.status === 'active'
                    ? colors.stepActive
                    : step.status === 'done'
                      ? colors.stepDone
                      : colors.stepPending
                }`}
              />
            ))}
          </div>
        )}

        {children && <div className='mt-6 w-full space-y-3'>{children}</div>}
      </div>
    </div>
  );
};

export default LoadingStatePanel;
