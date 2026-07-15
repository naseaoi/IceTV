'use client';

import { CSSProperties } from 'react';

const POSTER_GRADIENTS = [
  ['#1e3a8a', '#3b82f6'],
  ['#312e81', '#8b5cf6'],
  ['#7f1d1d', '#ef4444'],
  ['#7c2d12', '#f97316'],
  ['#134e4a', '#14b8a6'],
  ['#831843', '#ec4899'],
  ['#1e1b4b', '#6366f1'],
  ['#14532d', '#22c55e'],
  ['#713f12', '#eab308'],
  ['#0c4a6e', '#0ea5e9'],
  ['#4a044e', '#d946ef'],
  ['#450a0a', '#f87171'],
  ['#0f172a', '#64748b'],
  ['#4c1d95', '#a78bfa'],
  ['#064e3b', '#34d399'],
  ['#78350f', '#fbbf24'],
] as const;

const COVER_COUNT = 22;
const ROWS = 7;
// 线性格点排列：行间偏移 8、行内步长 5（与封面数互质），同屏重复间距最大化
const ROW_OFFSET_STEP = 8;
const COL_STRIDE = 5;

const COVERS = Array.from(
  { length: COVER_COUNT },
  (_, i) => `/login-posters/photo${String(i + 1).padStart(2, '0')}.webp`,
);

function posterStyle(row: number, col: number): CSSProperties {
  const [from, to] =
    POSTER_GRADIENTS[(row * 5 + col * 3) % POSTER_GRADIENTS.length];
  return {
    background: [
      'radial-gradient(120% 80% at 25% 0%, rgba(255,255,255,0.2), transparent 55%)',
      'linear-gradient(to top, rgba(0,0,0,0.5), transparent 60%)',
      `linear-gradient(160deg, ${from} 10%, ${to} 95%)`,
    ].join(','),
  };
}

function rowCovers(row: number): string[] {
  return Array.from(
    { length: COVER_COUNT },
    (_, i) => COVERS[(row * ROW_OFFSET_STEP + i * COL_STRIDE) % COVER_COUNT],
  );
}

export function PosterWallBackdrop() {
  return (
    <div
      aria-hidden
      className='pointer-events-none absolute inset-0 overflow-hidden bg-[#05070c]'
    >
      <div className='absolute inset-[-10%] flex rotate-[-4deg] scale-110 flex-col items-start justify-center gap-3 sm:gap-4'>
        {Array.from({ length: ROWS }, (_, row) => {
          const covers = rowCovers(row);
          return (
            <div
              key={row}
              className={`poster-marquee flex w-max shrink-0 ${
                row % 2 === 1 ? 'poster-marquee-reverse' : ''
              }`}
              style={{
                marginLeft: -(row % 3) * 64,
                animationDuration: `${180 + row * 24}s`,
                animationDelay: `${-row * 47}s`,
              }}
            >
              {[...covers, ...covers].map((src, col) => (
                <div
                  key={col}
                  className='relative mr-3 aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-lg opacity-90 sm:mr-4 sm:w-40 xl:w-48'
                  style={posterStyle(row, col)}
                >
                  <img
                    src={src}
                    alt=''
                    decoding='async'
                    className='absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-700'
                    ref={(el) => {
                      if (el?.complete) el.style.opacity = '1';
                    }}
                    onLoad={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className='to-[#05070c]/92 absolute inset-0 bg-gradient-to-b from-[#05070c]/80 via-[#05070c]/50 backdrop-blur-[3px]' />
      <div className='absolute inset-0 bg-[radial-gradient(110%_80%_at_50%_35%,transparent_35%,rgba(0,0,0,0.55)_100%)]' />
    </div>
  );
}
