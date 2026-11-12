import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { resolvePlayableSourceForUser } from '@/lib/quick-search.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const user = await requireActiveUser(request);
  if (isGuardFailure(user)) return user.response;
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();
  const type = searchParams.get('stype');
  const payload = query
    ? await resolvePlayableSourceForUser({
        user,
        query,
        year: searchParams.get('year') || '',
        searchType: type === 'tv' || type === 'movie' ? type : '',
        signal: request.signal,
      })
    : { detail: null, sources: [], searchedSources: 0 };
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
