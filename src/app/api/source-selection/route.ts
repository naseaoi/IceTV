import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { getSourceHealthTiers } from '@/lib/source-health.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guard = await requireActiveUser(request);
  if (isGuardFailure(guard)) return guard.response;

  try {
    const config = await getConfigForRead();
    const [sites, tiers] = await Promise.all([
      getAvailableApiSites(guard.username, config, guard.userAccess),
      getSourceHealthTiers(),
    ]);
    return NextResponse.json(
      Object.fromEntries(
        sites.flatMap(({ key }) => {
          const tier = tiers.get(key);
          return tier ? [[key, tier]] : [];
        }),
      ),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Failed to load source selection tiers', error);
    return NextResponse.json({ error: '播放源等级暂不可用' }, { status: 503 });
  }
}
