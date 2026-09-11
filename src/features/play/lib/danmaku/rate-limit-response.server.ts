import 'server-only';

import { NextResponse } from 'next/server';

import { DanmakuRateLimitError } from '@/features/play/lib/danmaku/types';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export function danmakuRateLimitResponse(error: unknown): NextResponse | null {
  if (!(error instanceof DanmakuRateLimitError)) return null;
  return NextResponse.json(
    {
      error: error.message,
      code: 'DANMAKU_RATE_LIMITED',
      retryAfterSeconds: error.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        ...NO_STORE_HEADERS,
        'Retry-After': String(error.retryAfterSeconds),
      },
    },
  );
}
