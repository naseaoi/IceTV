'use client';

import { type LucideIcon, CalendarDays, LayoutGrid } from 'lucide-react';

import type { ContinueWatchingView } from '@/features/continue-watching/lib/layout';
import {
  INDICATOR_TARGET_ATTR,
  useSlidingIndicator,
} from '@/hooks/useSlidingIndicator';

const VIEW_OPTIONS: {
  value: ContinueWatchingView;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: 'grid', label: '列表', icon: LayoutGrid },
  { value: 'calendar', label: '周历', icon: CalendarDays },
];

export function ContinueWatchingViewSwitch({
  view,
  onChange,
}: {
  view: ContinueWatchingView;
  onChange: (view: ContinueWatchingView) => void;
}) {
  const indicator = useSlidingIndicator<HTMLDivElement>(view);
  return (
    <div
      ref={indicator.containerRef}
      role='radiogroup'
      aria-label='视图'
      className='relative flex h-8 shrink-0 rounded-full bg-gray-900/[0.05] p-0.5 dark:bg-white/[0.06]'
    >
      {indicator.indicatorProps && (
        <span
          aria-hidden='true'
          ref={indicator.indicatorProps.ref}
          style={{ ...indicator.indicatorProps.style, top: undefined }}
          className='sliding-indicator bottom-0.5 top-0.5 rounded-full bg-white shadow-sm dark:bg-white/[0.14]'
        />
      )}
      {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = value === view;
        return (
          <button
            key={value}
            type='button'
            role='radio'
            aria-checked={selected}
            aria-label={label}
            title={label}
            {...(selected ? { [INDICATOR_TARGET_ATTR]: '' } : {})}
            onClick={() => onChange(value)}
            className={`relative flex w-9 items-center justify-center rounded-full transition-colors ${
              selected
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
            }`}
          >
            <Icon aria-hidden='true' className='h-4 w-4' />
          </button>
        );
      })}
    </div>
  );
}
