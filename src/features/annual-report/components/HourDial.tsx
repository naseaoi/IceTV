import type { CSSProperties, ReactNode } from 'react';

import {
  type Daypart,
  daypartOfHour,
} from '@/features/annual-report/lib/format';

const SIZE = 300;
const CENTER = SIZE / 2;
const INNER = 72;
const MAX_LENGTH = 54;
const LABELS = [0, 6, 12, 18];

function point(hour: number, radius: number): [number, number] {
  const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
  return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius];
}

export function HourDial({
  hours,
  peakHour,
  highlight,
  children,
}: {
  hours: number[];
  peakHour: number;
  highlight: Daypart | null;
  children?: ReactNode;
}) {
  const max = Math.max(...hours, 1);
  return (
    <div className='relative mx-auto aspect-square w-full max-w-[288px]'>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className='h-full w-full'
        aria-hidden
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={INNER - 12}
          fill='none'
          strokeWidth={0.75}
          className='stroke-gray-900/10 dark:stroke-white/10'
        />
        {hours.map((value, hour) => {
          const length =
            value > 0 ? Math.max(6, (value / max) * MAX_LENGTH) : 1.5;
          const [x1, y1] = point(hour + 0.5, INNER);
          const [x2, y2] = point(hour + 0.5, INNER + length);
          const inHighlight =
            highlight !== null && daypartOfHour(hour).key === highlight.key;
          const tone =
            hour === peakHour
              ? 'stroke-brand-600 dark:stroke-brand-300'
              : inHighlight
                ? 'stroke-brand-300 dark:stroke-brand-700'
                : 'stroke-gray-300 dark:stroke-gray-700';
          return (
            <line
              key={hour}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              pathLength={1}
              strokeWidth={3.5}
              strokeLinecap='round'
              className={`recap-dial-bar ${tone}`}
              style={{ '--d': hour } as CSSProperties}
            />
          );
        })}
        {LABELS.map((hour) => {
          const [x, y] = point(hour, INNER + MAX_LENGTH + 16);
          return (
            <text
              key={hour}
              x={x}
              y={y}
              fontSize={11}
              textAnchor='middle'
              dominantBaseline='central'
              className='fill-gray-400 dark:fill-gray-500'
            >
              {String(hour).padStart(2, '0')}
            </text>
          );
        })}
      </svg>
      <div className='absolute inset-0 flex flex-col items-center justify-center text-center'>
        {children}
      </div>
    </div>
  );
}
