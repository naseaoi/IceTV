import { NextRequest } from 'next/server';

import { handleViewingInsights } from '@/lib/viewing-insights.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) {
  return handleViewingInsights(request, 'opinions');
}
