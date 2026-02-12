import React from 'react';

type Tone = 'emerald' | 'blue' | 'amber' | 'red';

type StepItem = {
  label: string;
  status: 'pending' | 'active' | 'done';
};

interface LoadingStatePanelProps {
  icon: React.ReactNode;
  title: string;
  message?: string;
  description?: string;
  tone?: Tone;
  progress?: number;
  steps?: StepItem[];
  compact?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const toneMap: Record<
  Tone,
  {
    halo: string;
    orb: string;
    ring: string;
    ripple: string;
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
    orb: 'bg-emerald-400/40',
    ring: 'from-emerald-400/70 via-green-500/40 to-emerald-300/20',
    ripple: 'border-emerald-300/45 dark:border-emerald-400/30',
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
    orb: 'bg-sky-400/40',
    ring: 'from-sky-400/70 via-blue-500/40 to-sky-300/20',
    ripple: 'border-sky-300/45 dark:border-sky-400/30',
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
    orb: 'bg-amber-400/40',
    ring: 'from-amber-400/70 via-orange-500/40 to-amber-300/20',
    ripple: 'border-amber-300/45 dark:border-amber-400/30',
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
    orb: 'bg-red-400/40',
    ring: 'from-red-400/70 via-rose-500/40 to-red-300/20',
    ripple: 'border-red-300/45 dark:border-red-400/30',
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
  message,
  description,
  tone = 'emerald',
  progress,
  steps,
  compact = false,
  className = '',
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
        className={`pointer-events-none absolute -top-24 -left-20 h-56 w-56 rounded-full bg-gradient-to-br ${colors.halo} blur-2xl`}
      />
      <div className='pointer-events-none absolute -bottom-24 -right-16 h-52 w-52 rounded-full bg-white/20 dark:bg-white/5 blur-2xl' />

      <div className='relative flex flex-col items-center text-center'>
        <div className='relative mb-7'>
          <div
            className={`ls-ripple absolute -inset-5 rounded-full border ${colors.ripple}`}
          />
          <div
            className={`ls-ripple ls-ripple-delay absolute -inset-5 rounded-full border ${colors.ripple}`}
          />
          <div className='ls-spinner-shell relative z-[2] mx-auto h-24 w-24'>
            <div
              className={`ls-spinner-ring-outer absolute inset-0 rounded-full border-2 border-transparent bg-gradient-to-r ${colors.ring}`}
            />
            <div className='ls-spinner-ring-inner absolute inset-[10px] rounded-full border border-white/40 dark:border-white/20' />
            <div className='ls-spinner-cutout absolute inset-[2px] rounded-full bg-transparent' />
            <div
              className={`ls-float absolute inset-0 z-[2] flex items-center justify-center ${colors.iconTone}`}
            >
              {icon}
            </div>
          </div>
          <div
            className={`ls-ping-soft absolute top-3 right-2 h-3.5 w-3.5 rounded-full ${colors.orb}`}
          />
        </div>

        <h3 className={`text-2xl font-semibold tracking-tight ${colors.text}`}>
          {title}
        </h3>
        {message && (
          <p className={`mt-2 text-base font-medium ${colors.mutedText}`}>
            {message}
          </p>
        )}
        {description && (
          <p className={`mt-2 text-sm leading-6 ${colors.mutedText}`}>
            {description}
          </p>
        )}

        {typeof progress === 'number' && (
          <div className='mt-6 w-full max-w-[22rem]'>
            <div
              className={`h-2.5 overflow-hidden rounded-full ${colors.track}`}
            >
              <div
                className={`ls-shimmer h-full rounded-full bg-gradient-to-r ${colors.fill} transition-all duration-700 ease-out`}
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

      <style jsx>{`
        .ls-ripple {
          animation: ls-ripple 2.4s ease-out infinite;
          transform-origin: center;
        }

        .ls-ripple-delay {
          animation-delay: 1.2s;
        }

        .ls-spinner-shell {
          filter: drop-shadow(0 8px 26px rgba(0, 0, 0, 0.12));
        }

        .ls-spinner-ring-outer {
          mask: radial-gradient(circle, transparent 58%, black 59%);
          -webkit-mask: radial-gradient(circle, transparent 58%, black 59%);
          animation: ls-rotate 2.6s linear infinite;
        }

        .ls-spinner-ring-inner {
          animation: ls-rotate-reverse 3.3s linear infinite;
        }

        .ls-float {
          animation: ls-float 2.8s ease-in-out infinite;
        }

        .ls-ping-soft {
          animation: ls-ping-soft 1.8s ease-out infinite;
        }

        .ls-shimmer {
          background-size: 200% 100%;
          animation: ls-shimmer 2.2s linear infinite;
        }

        @keyframes ls-rotate {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes ls-rotate-reverse {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(-360deg);
          }
        }

        @keyframes ls-float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-5px);
          }
        }

        @keyframes ls-ripple {
          0% {
            transform: scale(0.92);
            opacity: 0.45;
          }
          70% {
            transform: scale(1.2);
            opacity: 0;
          }
          100% {
            transform: scale(1.2);
            opacity: 0;
          }
        }

        @keyframes ls-ping-soft {
          0% {
            transform: scale(0.9);
            opacity: 0.65;
          }
          70% {
            transform: scale(1.9);
            opacity: 0;
          }
          100% {
            transform: scale(1.9);
            opacity: 0;
          }
        }

        @keyframes ls-shimmer {
          0% {
            background-position: 0% 0%;
          }
          100% {
            background-position: 200% 0%;
          }
        }
      `}</style>
    </div>
  );
};

export default LoadingStatePanel;
