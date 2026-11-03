import { NextRequest } from 'next/server';

import {
  type ProfileRouteContext,
  handlePublicUser,
} from '@/lib/user-profile.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest, context: ProfileRouteContext) {
  return handlePublicUser(request, context, 'reviews');
}
