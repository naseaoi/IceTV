import { notFound } from 'next/navigation';

import { getPublicConfig } from '@/lib/config';

import LivePageClient from './LivePageClient';

export default async function LivePage() {
  const config = await getPublicConfig();

  if (!config.EnableLiveEntry) {
    notFound();
  }

  return <LivePageClient />;
}
