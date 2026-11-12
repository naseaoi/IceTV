import { NextRequest } from 'next/server';

import { handleLists } from '@/features/lists/lib/lists.server';

export const runtime = 'nodejs';
export function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId?: string }> },
) {
  return handleLists(request, 'detail', context);
}
export function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId?: string }> },
) {
  return handleLists(request, 'detail', context);
}
export function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId?: string }> },
) {
  return handleLists(request, 'detail', context);
}
