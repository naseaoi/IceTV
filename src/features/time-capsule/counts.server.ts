import 'server-only';

import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';
import { db } from '@/lib/db';

export async function getCapsuleCountsForCurrentUser(): Promise<{
  pending: number;
  delivered: number;
  unread: number;
}> {
  const session = await getServerAuthSession(
    (await cookies()).get('auth')?.value,
  );
  if (session.status !== 'authenticated')
    return { pending: 0, delivered: 0, unread: 0 };
  return db.countCapsules(session.username);
}
