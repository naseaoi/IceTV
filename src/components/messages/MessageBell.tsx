'use client';

import { Bell } from 'lucide-react';

import AnimatedCount from '@/components/AnimatedCount';
import { useAuthSession } from '@/components/AuthProvider';

import { useMessageCenter } from './MessageCenterProvider';

function formatUnread(count: number) {
  return count > 99 ? '99+' : String(count);
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className='motion-badge-in absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white'>
      <AnimatedCount value={count} format={formatUnread} />
    </span>
  );
}

export default function MessageBell({
  className = 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
}: {
  className?: string;
}) {
  const { session } = useAuthSession();
  const { unreadCount, openPanel } = useMessageCenter();

  if (session.status !== 'authenticated') return null;

  const handleClick = () => {
    openPanel();
  };

  return (
    <button
      type='button'
      onClick={handleClick}
      aria-label={`我的消息${unreadCount ? `，${unreadCount} 条未读` : ''}`}
      title='我的消息'
      className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-colors ${className}`}
    >
      <Bell className='h-5 w-5' />
      <UnreadBadge count={unreadCount} />
    </button>
  );
}
