import { NextRequest } from 'next/server';

import { handleFollowOpinions } from '@/lib/viewing-insights.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) {
  return handleFollowOpinions(request);
}
