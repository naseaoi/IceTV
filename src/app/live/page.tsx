import { notFound } from 'next/navigation';

import LivePageClient from '@/features/live/LivePageClient';
import { getPublicConfig } from '@/lib/config';

export default async function LivePage() {
  const config = await getPublicConfig();

  if (!config.EnableLiveEntry) {
    notFound();
  }

  return <LivePageClient />;
}
