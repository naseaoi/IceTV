import { NextRequest } from 'next/server';

import { handleReviewReaction } from '@/lib/review-reactions.server';

export const runtime = 'nodejs';
export function PUT(request: NextRequest) {
  return handleReviewReaction(request, 'like');
}
export function DELETE(request: NextRequest) {
  return handleReviewReaction(request, 'like');
}
