import Avatar from 'boring-avatars';

import type { PublicUserRef } from '@/lib/types';

const AVATAR_COLORS = ['#8fc4e6', '#3d8dc6', '#21435f', '#f5c6a5', '#a8d8c8'];

export default function ProfileAvatar({
  user,
  className = 'h-8 w-8',
}: {
  user: Pick<PublicUserRef, 'profileId' | 'avatarSeed'>;
  className?: string;
}) {
  return (
    <Avatar
      aria-hidden='true'
      name={user.avatarSeed ?? user.profileId}
      variant='beam'
      colors={AVATAR_COLORS}
      className={`shrink-0 ${className}`}
    />
  );
}
