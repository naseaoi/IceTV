import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import LivePageClient from '@/features/live/LivePageClient';
import { getServerAuthSession } from '@/lib/auth-session.server';
import { getConfigForRead } from '@/lib/config';
import { canUserWatchLive } from '@/lib/live-access.server';

export default async function LivePage() {
  const cookieStore = await cookies();
  const [config, session] = await Promise.all([
    getConfigForRead(),
    getServerAuthSession(cookieStore.get('auth')?.value),
  ]);

  if (
    config.SiteConfig.EnableLiveEntry !== true ||
    (session.status === 'authenticated' &&
      !(await canUserWatchLive(session.username, config)))
  ) {
    notFound();
  }

  return <LivePageClient />;
}
