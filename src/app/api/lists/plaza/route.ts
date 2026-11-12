import { NextRequest } from 'next/server';

import { handleLists } from '@/features/lists/lib/lists.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) {
  return handleLists(request, 'plaza');
}
