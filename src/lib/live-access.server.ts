import 'server-only';

import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { normalizeUsername } from '@/lib/username';
import type { AdminConfig } from '@/types/admin';

export async function canUserWatchLive(
  username: string | null | undefined,
  config?: Readonly<AdminConfig>,
): Promise<boolean> {
  const currentConfig = config ?? (await getConfigForRead());
  if (currentConfig.SiteConfig.EnableLiveEntry !== true) return false;
  if (currentConfig.SiteConfig.LiveAccess !== 'groups') return true;
  if (!username) return false;

  const normalized = normalizeUsername(username);
  if (!normalized) return false;
  if (normalized === normalizeUsername(getOwnerUsername())) return true;

  const user = await db.getUserAccess(normalized);
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'owner') return true;

  return (currentConfig.UserConfig.Tags ?? []).some(
    (group) => group.allowLive === true && user.tags?.includes(group.name),
  );
}
