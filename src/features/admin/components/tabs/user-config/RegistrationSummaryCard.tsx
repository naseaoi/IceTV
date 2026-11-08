'use client';

import { Settings2, Ticket, UserPlus, UserX } from 'lucide-react';

import AnimatedCount from '@/components/AnimatedCount';
import SkeletonText from '@/components/SkeletonText';
import { ADMIN_PANEL_CLASS } from '@/features/admin/components/AdminSettings';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { MAX_INVITE_CODES } from '@/features/admin/services/inviteCodes';

interface RegistrationSummaryCardProps {
  openRegister: boolean;
  requireInviteCode: boolean;
  activeInviteCodeCount: number;
  onManage: () => void;
}

const CARD_CLASS = `${ADMIN_PANEL_CLASS} flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5`;
const TILE_CLASS = 'h-10 w-10 shrink-0 rounded-xl';
const TITLE_CLASS = 'text-sm font-semibold';

const MODE = {
  closed: {
    label: '已关闭',
    Icon: UserX,
    tile: 'bg-gray-100 text-gray-500 ring-gray-200 dark:bg-white/[0.04] dark:text-gray-400 dark:ring-white/[0.06]',
    pill: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400',
    dot: 'bg-gray-400 dark:bg-gray-500',
  },
  open: {
    label: '开放注册',
    Icon: UserPlus,
    tile: 'bg-brand-50 text-brand-600 ring-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20',
    pill: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  invite: {
    label: '邀请注册',
    Icon: Ticket,
    tile: 'bg-brand-50 text-brand-600 ring-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20',
    pill: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
} as const;

function InviteCodeCount({
  value,
  className,
}: {
  value: number;
  className: string;
}) {
  return (
    <span className={`tabular-nums ${className}`}>
      <AnimatedCount value={value} />
      <span className='font-normal text-gray-400 dark:text-gray-500'>
        {' '}
        / {MAX_INVITE_CODES}
      </span>
    </span>
  );
}

export function RegistrationSummaryCard({
  openRegister,
  requireInviteCode,
  activeInviteCodeCount,
  onManage,
}: RegistrationSummaryCardProps) {
  const mode = !openRegister ? 'closed' : requireInviteCode ? 'invite' : 'open';
  const { label, Icon, tile, pill, dot } = MODE[mode];
  const showInviteCount = mode === 'invite';

  return (
    <section
      aria-labelledby='registration-summary-title'
      className={CARD_CLASS}
    >
      <span
        aria-hidden='true'
        className={`flex items-center justify-center ring-1 ring-inset ${TILE_CLASS} ${tile}`}
      >
        <Icon className='h-5 w-5' />
      </span>

      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <h2
            id='registration-summary-title'
            className={`${TITLE_CLASS} text-gray-900 dark:text-gray-100`}
          >
            用户注册
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${pill}`}
          >
            <span
              aria-hidden='true'
              className={`h-1.5 w-1.5 rounded-full ${dot}`}
            />
            {label}
          </span>
        </div>
        {showInviteCount && (
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400 sm:hidden'>
            有效邀请码{' '}
            <InviteCodeCount
              value={activeInviteCodeCount}
              className='font-medium text-gray-900 dark:text-gray-100'
            />
          </p>
        )}
      </div>

      {showInviteCount && (
        <div className='hidden shrink-0 border-l border-gray-200 pl-4 text-right dark:border-white/[0.06] sm:block'>
          <p className='text-xs text-gray-500 dark:text-gray-400'>有效邀请码</p>
          <InviteCodeCount
            value={activeInviteCodeCount}
            className='text-base font-semibold leading-6 text-gray-900 dark:text-gray-100'
          />
        </div>
      )}

      <button
        type='button'
        onClick={onManage}
        className={`${buttonStyles.outline} inline-flex shrink-0 items-center gap-1.5`}
      >
        <Settings2 className='h-4 w-4' />
        管理
      </button>
    </section>
  );
}

export function RegistrationSummaryCardSkeleton() {
  return (
    <div className={CARD_CLASS}>
      <div className={`skeleton ${TILE_CLASS}`} />
      <div className='min-w-0 flex-1'>
        <SkeletonText
          className={TITLE_CLASS}
          barClassName='h-3.5 w-36 rounded'
        />
      </div>
      <div className='skeleton h-8 w-[74px] shrink-0 rounded-lg' />
    </div>
  );
}
