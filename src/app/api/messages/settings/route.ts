import { NextRequest } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { validateMutedKinds } from '@/lib/social-notification-identity';
import {
  socialBody,
  socialFailure,
  socialJson,
} from '@/lib/user-profile.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    return socialJson({
      mutedKinds:
        (await db.getUserMessageState(guard.username)).mutedKinds ?? [],
    });
  } catch (error) {
    return socialFailure(error);
  }
}
export async function PUT(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const body = await socialBody(request);
    const mutedKinds = validateMutedKinds(body.mutedKinds);
    const state = await db.updateUserMessageState(guard.username, {
      notificationSettings: { mutedKinds, now: Date.now() },
    });
    return socialJson({ mutedKinds: state.mutedKinds ?? [] });
  } catch (error) {
    return socialFailure(error);
  }
}
