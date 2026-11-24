import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  HOME_POSTER_CARD_CLASS,
  POSTER_CARD_SUBTITLE_ROW_CLASS,
  POSTER_CARD_TITLE_ROW_CLASS,
  POSTER_DASHED_SLOT_CLASS,
} from '@/components/poster-card-layout';
import ScrollableRow from '@/components/ScrollableRow';
import SkeletonText from '@/components/SkeletonText';

// 首格之后的虚线格逐格淡出，示意这一排会被海报填满
const GHOST_SLOT_OPACITY = [
  'opacity-75',
  'opacity-50',
  'opacity-30',
  'opacity-15',
];

const LEAD_SLOT_CLASS = `${POSTER_DASHED_SLOT_CLASS} flex w-full flex-col items-center justify-center gap-2 px-2 text-center`;

// 海报下方文字行留白，空横排与真实横排同高
function SlotTextRows({ subtitle }: { subtitle: boolean }) {
  return (
    <>
      <p aria-hidden='true' className={POSTER_CARD_TITLE_ROW_CLASS}>
        &nbsp;
      </p>
      {subtitle && (
        <p aria-hidden='true' className={POSTER_CARD_SUBTITLE_ROW_CLASS}>
          &nbsp;
        </p>
      )}
    </>
  );
}

function LeadSlotContent({
  icon,
  label,
  actionLabel,
}: {
  icon: ReactNode;
  label: string;
  actionLabel?: string;
}) {
  return (
    <>
      <span
        aria-hidden='true'
        className='flex text-gray-400 transition group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300 [&>svg]:h-5 [&>svg]:w-5'
      >
        {icon}
      </span>
      <span className='text-xs text-gray-500 dark:text-gray-400 sm:text-sm'>
        {label}
      </span>
      {actionLabel && (
        <span className='inline-flex items-center text-xs text-gray-700 transition group-hover:text-gray-900 dark:text-gray-200 dark:group-hover:text-white'>
          {actionLabel}
          <ChevronRight aria-hidden='true' className='h-3.5 w-3.5' />
        </span>
      )}
    </>
  );
}

// 海报横排的空状态：首格给出提示与入口，其余虚线格占住整排高度。
// placeholder 用于已知为 0 但尚未确认的加载阶段，计数可能是旧值，首格不提前显示提示。
export function PosterShelfEmpty({
  icon,
  label,
  action,
  subtitle = false,
  placeholder = false,
}: {
  icon: ReactNode;
  label: string;
  action?: { href: string; label: string };
  subtitle?: boolean;
  placeholder?: boolean;
}) {
  let lead: ReactNode;
  if (placeholder) {
    lead = (
      <div aria-hidden='true' className={LEAD_SLOT_CLASS}>
        <span className='skeleton h-5 w-5 rounded-full' />
        <SkeletonText
          className='text-xs sm:text-sm'
          barClassName='h-3 w-16 rounded'
        />
      </div>
    );
  } else if (action) {
    lead = (
      <Link
        href={action.href}
        className={`${LEAD_SLOT_CLASS} group transition hover:border-gray-400 hover:bg-gray-100/80 dark:hover:border-white/20 dark:hover:bg-white/[0.04]`}
      >
        <LeadSlotContent icon={icon} label={label} actionLabel={action.label} />
      </Link>
    );
  } else {
    lead = (
      <div className={LEAD_SLOT_CLASS}>
        <LeadSlotContent icon={icon} label={label} />
      </div>
    );
  }

  return (
    <ScrollableRow>
      <div className={HOME_POSTER_CARD_CLASS}>
        {lead}
        <SlotTextRows subtitle={subtitle} />
      </div>
      {GHOST_SLOT_OPACITY.map((opacity) => (
        <div
          key={opacity}
          aria-hidden='true'
          className={`${HOME_POSTER_CARD_CLASS} ${opacity}`}
        >
          <div className={POSTER_DASHED_SLOT_CLASS} />
          <SlotTextRows subtitle={subtitle} />
        </div>
      ))}
    </ScrollableRow>
  );
}
