import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized, parseCronTask } from '@/lib/cron/request';
import { startCronTask } from '@/lib/cron/runner';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    if (!isCronAuthorized(request.headers)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const task = parseCronTask(request.url);
    if (!task) {
      return NextResponse.json({ error: 'Invalid cron task' }, { status: 400 });
    }

    const result = await startCronTask(task);
    return NextResponse.json(result.payload, { status: result.status });
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
