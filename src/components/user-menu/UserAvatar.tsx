'use client';

import { CircleUserRound } from 'lucide-react';

export type UserAvatarRole = 'owner' | 'admin' | 'user';

type UserAvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<UserAvatarSize, string> = {
  sm: 'h-6 w-6 text-[11px]',
  md: 'h-7 w-7 text-xs',
  lg: 'h-10 w-10 text-base',
};

const ROLE_AVATAR_CLASS: Record<UserAvatarRole, string> = {
  owner:
    'bg-gradient-to-br from-yellow-200 to-amber-100 text-amber-700 dark:from-yellow-500/25 dark:to-amber-500/10 dark:text-yellow-200',
  admin:
    'bg-gradient-to-br from-purple-200 to-purple-100 text-purple-700 dark:from-purple-500/25 dark:to-purple-500/10 dark:text-purple-200',
  user: 'bg-gradient-to-br from-green-200 to-green-100 text-green-700 dark:from-green-500/25 dark:to-green-500/10 dark:text-green-200',
};

interface UserAvatarProps {
  username?: string;
  role?: UserAvatarRole;
  size?: UserAvatarSize;
  className?: string;
}

export function UserAvatar({
  username,
  role = 'user',
  size = 'md',
  className = '',
}: UserAvatarProps) {
  const baseClass = `flex flex-shrink-0 select-none items-center justify-center rounded-full ${SIZE_CLASS[size]} ${className}`;

  if (!username) {
    return (
      <span
        className={`${baseClass} bg-gray-200/80 text-gray-500 dark:bg-gray-700/80 dark:text-gray-400`}
      >
        <CircleUserRound className='h-[70%] w-[70%]' />
      </span>
    );
  }

  return (
    <span className={`${baseClass} font-semibold ${ROLE_AVATAR_CLASS[role]}`}>
      {username.charAt(0).toUpperCase()}
    </span>
  );
}
