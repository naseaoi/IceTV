import { CircleUserRound } from 'lucide-react';

type UserAvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<UserAvatarSize, string> = {
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
  lg: 'h-10 w-10',
};

// 游客占位头像；登录用户统一用 ProfileAvatar
export function UserAvatar({
  size = 'md',
  className = '',
}: {
  size?: UserAvatarSize;
  className?: string;
}) {
  return (
    <span
      className={`flex flex-shrink-0 select-none items-center justify-center rounded-full bg-gray-200/80 text-gray-500 dark:bg-gray-700/80 dark:text-gray-400 ${SIZE_CLASS[size]} ${className}`}
    >
      <CircleUserRound className='h-[70%] w-[70%]' />
    </span>
  );
}
