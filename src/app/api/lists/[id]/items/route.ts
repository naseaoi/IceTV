import { NextRequest } from 'next/server';

import { handleLists } from '@/features/lists/lib/lists.server';

export const runtime = 'nodejs';
export function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId?: string }> },
) {
  return handleLists(request, 'items', context);
}
