import { Globe, Lock } from 'lucide-react';

import { POSTER_BADGE_NEUTRAL_CLASS } from '@/components/poster-card-layout';
import type { ListVisibility } from '@/features/lists/types';

// 仅登录用户可见是公开片单的默认形态，不额外标注
export function ListVisibilityBadge({
  visibility,
  variant = 'inline',
}: {
  visibility: ListVisibility;
  variant?: 'inline' | 'cover';
}) {
  if (visibility === 'members') return null;
  const Icon = visibility === 'private' ? Lock : Globe;
  const label = visibility === 'private' ? '私密' : '游客可见';
  if (variant === 'cover') {
    return (
      <span className={`${POSTER_BADGE_NEUTRAL_CLASS} gap-1`}>
        <Icon aria-hidden='true' className='h-3 w-3' />
        {label}
      </span>
    );
  }
  return (
    <span className='inline-flex items-center gap-1'>
      <Icon aria-hidden='true' className='h-3.5 w-3.5' />
      {label}
    </span>
  );
}
