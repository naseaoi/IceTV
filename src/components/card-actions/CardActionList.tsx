import { Fragment } from 'react';

import type { CardAction } from '@/components/card-actions/actions';

const VARIANT_CLASS = {
  menu: {
    item: 'h-9 gap-2.5 rounded-lg pl-2.5 pr-5 text-sm [&_svg]:h-4 [&_svg]:w-4',
    separator: 'mx-1.5 my-1',
  },
  sheet: {
    item: 'h-12 gap-3.5 rounded-xl px-3 text-[15px] [&_svg]:h-5 [&_svg]:w-5',
    separator: 'mx-3 my-1.5',
  },
} as const;

function getToneClass(action: CardAction) {
  if (action.disabled) {
    return 'cursor-default text-gray-400 dark:text-gray-500';
  }
  if (action.tone === 'danger') {
    return 'text-red-600 hover:bg-red-500/[0.08] focus-visible:bg-red-500/[0.08] active:bg-red-500/[0.12] dark:text-red-400 dark:hover:bg-red-400/10 dark:focus-visible:bg-red-400/10';
  }
  return 'text-gray-700 hover:bg-gray-900/[0.05] focus-visible:bg-gray-900/[0.05] active:bg-gray-900/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06] dark:active:bg-white/[0.09]';
}

interface CardActionListProps {
  actions: CardAction[];
  variant: keyof typeof VARIANT_CLASS;
  onAction: (action: CardAction) => void;
}

export default function CardActionList({
  actions,
  variant,
  onAction,
}: CardActionListProps) {
  const styles = VARIANT_CLASS[variant];

  return (
    <>
      {actions.map((action, index) => (
        <Fragment key={action.id}>
          {index > 0 &&
            action.tone === 'danger' &&
            actions[index - 1].tone !== 'danger' && (
              <div
                role='separator'
                className={`h-px bg-gray-900/[0.06] dark:bg-white/[0.06] ${styles.separator}`}
              />
            )}
          <button
            type='button'
            role='menuitem'
            disabled={action.disabled}
            onClick={() => onAction(action)}
            className={`flex w-full items-center text-left outline-none transition-colors ${styles.item} ${getToneClass(action)}`}
          >
            <span
              className={`flex shrink-0 items-center ${
                action.tone === 'danger' || action.disabled
                  ? ''
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {action.icon}
            </span>
            <span className='min-w-0 flex-1 truncate'>{action.label}</span>
          </button>
        </Fragment>
      ))}
    </>
  );
}
