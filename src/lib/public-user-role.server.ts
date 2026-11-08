import { getOwnerUsername } from '@/lib/env.server';
import type { PublicUserRef } from '@/lib/types';
import { normalizeUsername } from '@/lib/username';

export function publicUserRole(
  username: string,
  accessRole: string | null | undefined,
): PublicUserRef['role'] {
  const owner = normalizeUsername(getOwnerUsername());
  if (owner && normalizeUsername(username) === owner) return 'owner';
  return accessRole === 'owner' || accessRole === 'admin'
    ? accessRole
    : undefined;
}
