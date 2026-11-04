import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { getSourceHealthReport } from '@/lib/source-health.server';
import { normalizeSourceHealthDays } from '@/lib/source-quality-policy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const days = normalizeSourceHealthDays(
      request.nextUrl.searchParams.get('days'),
    );
    const items = await getSourceHealthReport(days);
    return NextResponse.json(
      { days, items },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Failed to read source health', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
