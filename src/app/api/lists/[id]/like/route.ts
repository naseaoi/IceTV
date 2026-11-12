import { NextRequest } from 'next/server';

import { handleLists } from '@/features/lists/lib/lists.server';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function PUT(request: NextRequest, context: Context) {
  return handleLists(request, 'like', context);
}
export function DELETE(request: NextRequest, context: Context) {
  return handleLists(request, 'like', context);
}
