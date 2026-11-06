import { Radio } from 'lucide-react';

interface SourceNameBadgeProps {
  sourceName?: string;
  origin?: 'vod' | 'live';
  className?: string;
}

export default function SourceNameBadge({
  sourceName,
  origin = 'vod',
  className = '',
}: SourceNameBadgeProps) {
  if (!sourceName) {
    return null;
  }

  return (
    <span
      data-source-name-badge
      title={sourceName}
      className={`pointer-events-none z-10 inline-flex w-fit min-w-0 items-center overflow-hidden rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-white shadow-sm transition-opacity duration-200 sm:px-2 sm:py-1 sm:text-xs ${className}`}
    >
      {origin === 'live' && <Radio className='mr-1 h-3 w-3 shrink-0' />}
      <span className='truncate'>{sourceName}</span>
    </span>
  );
}
