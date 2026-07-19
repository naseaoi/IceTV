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
      className={`pointer-events-none z-10 inline-flex w-fit min-w-0 items-center overflow-hidden rounded bg-black/60 px-2 py-1 text-xs font-medium leading-4 text-white shadow-sm backdrop-blur-sm transition-opacity duration-200 max-sm:px-1.5 max-sm:py-0.5 max-sm:text-[10px] ${className}`}
    >
      {origin === 'live' && <Radio className='mr-1 h-3 w-3 shrink-0' />}
      <span className='truncate'>{sourceName}</span>
    </span>
  );
}
