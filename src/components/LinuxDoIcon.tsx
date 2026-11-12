import { useId } from 'react';

export function LinuxDoIcon({ className }: { className?: string }) {
  const clipId = useId();
  return (
    <svg viewBox='0 0 120 120' className={className} aria-hidden='true'>
      <clipPath id={clipId}>
        <circle cx='60' cy='60' r='47' />
      </clipPath>
      <circle cx='60' cy='60' r='50' fill='#f0f0f0' />
      <g clipPath={`url(#${clipId})`}>
        <rect x='10' y='10' width='100' height='30' fill='#1c1c1e' />
        <rect x='10' y='40' width='100' height='40' fill='#f0f0f0' />
        <rect x='10' y='80' width='100' height='30' fill='#ffb003' />
      </g>
    </svg>
  );
}
