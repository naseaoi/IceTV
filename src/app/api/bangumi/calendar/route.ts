import { NextResponse } from 'next/server';

import { getBangumiCalendarData } from '@/lib/bangumi';

const HOME_REVALIDATE_SECONDS = 21600;

export const runtime = 'nodejs';
export const revalidate = 21600;

export async function GET() {
  try {
    const data = await getBangumiCalendarData({
      next: { revalidate: HOME_REVALIDATE_SECONDS },
    });

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=21600',
      },
    });
  } catch {
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    });
  }
}
