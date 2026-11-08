import { NextRequest } from 'next/server';

import { handleReviewReaction } from '@/lib/review-reactions.server';

export const runtime = 'nodejs';
export function POST(request: NextRequest) {
  return handleReviewReaction(request, 'report');
}
