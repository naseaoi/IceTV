// 与 Spinner 同构的静态标记，供 ArtPlayer 等只接受 HTML 字符串的场景复用 globals.css 中的动画
export const SPINNER_MARKUP =
  '<svg class="ice-spinner" viewBox="0 0 48 48" aria-hidden="true">' +
  '<circle class="ice-spinner-track" cx="24" cy="24" r="20" fill="none" stroke-width="4"></circle>' +
  '<circle class="ice-spinner-arc" cx="24" cy="24" r="20" fill="none" stroke-width="4"></circle>' +
  '</svg>';

interface SpinnerProps {
  className?: string;
  strokeWidth?: number;
  label?: string;
}

export default function Spinner({
  className = 'h-5 w-5',
  strokeWidth = 4,
  label,
}: SpinnerProps) {
  return (
    <svg
      viewBox='0 0 48 48'
      className={`ice-spinner shrink-0 ${className}`}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        className='ice-spinner-track'
        cx='24'
        cy='24'
        r='20'
        fill='none'
        strokeWidth={strokeWidth}
      />
      <circle
        className='ice-spinner-arc'
        cx='24'
        cy='24'
        r='20'
        fill='none'
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
