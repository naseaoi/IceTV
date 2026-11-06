import { Radio } from 'lucide-react';

import { POSTER_BADGE_NEUTRAL_CLASS } from '@/components/poster-card-layout';

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
      className={`pointer-events-none z-10 w-fit min-w-0 overflow-hidden ${POSTER_BADGE_NEUTRAL_CLASS} ${className}`}
    >
      {origin === 'live' && <Radio className='mr-1 h-3 w-3 shrink-0' />}
      <span className='truncate'>{sourceName}</span>
    </span>
  );
}
