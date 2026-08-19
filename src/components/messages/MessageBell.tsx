'use client';

import { Bell } from 'lucide-react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  getSidebarItemLabelClass,
  SIDEBAR_BUTTON_STATE_CLASS,
  SIDEBAR_ITEM_ICON_CLASS,
  SIDEBAR_ITEM_ICON_WRAP_CLASS,
  SIDEBAR_ITEM_LAYOUT_CLASS,
} from '@/components/SidebarItem';

import { useMessageCenter } from './MessageCenterProvider';

interface MessageBellProps {
  variant?: 'icon' | 'sidebar';
  isCollapsed?: boolean;
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className='absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-white dark:ring-gray-900'>
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function MessageBell({
  variant = 'icon',
  isCollapsed = false,
}: MessageBellProps) {
  const { session } = useAuthSession();
  const { unreadCount, openPanel } = useMessageCenter();

  if (session.status !== 'authenticated') return null;

  const handleClick = () => {
    openPanel();
  };

  if (variant === 'sidebar') {
    return (
      <button
        type='button'
        onClick={handleClick}
        aria-label={`我的消息${unreadCount ? `，${unreadCount} 条未读` : ''}`}
        className={`${SIDEBAR_ITEM_LAYOUT_CLASS} w-full ${SIDEBAR_BUTTON_STATE_CLASS}`}
        title={isCollapsed ? '我的消息' : undefined}
      >
        <div className={`${SIDEBAR_ITEM_ICON_WRAP_CLASS} relative`}>
          <Bell className={SIDEBAR_ITEM_ICON_CLASS} />
          <UnreadBadge count={unreadCount} />
        </div>
        <span
          data-sidebar-label
          className={getSidebarItemLabelClass(isCollapsed)}
        >
          消息
        </span>
      </button>
    );
  }

  return (
    <button
      type='button'
      onClick={handleClick}
      aria-label={`我的消息${unreadCount ? `，${unreadCount} 条未读` : ''}`}
      title='我的消息'
      className='relative flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
    >
      <Bell className='h-5 w-5' />
      <UnreadBadge count={unreadCount} />
    </button>
  );
}
