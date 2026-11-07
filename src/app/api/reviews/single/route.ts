import { NextRequest } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { socialFailure, socialJson } from '@/lib/user-profile.server';
import { ReviewValidationError } from '@/lib/video-reviews';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const profileId = request.nextUrl.searchParams.get('profileId');
    const title_norm = request.nextUrl.searchParams.get('title_norm');
    const year = request.nextUrl.searchParams.get('year');
    if (
      !profileId ||
      !/^[A-Za-z0-9]{12}$/.test(profileId) ||
      !title_norm?.trim() ||
      title_norm.length > 191 ||
      year === null ||
      year.length > 16
    )
      throw new ReviewValidationError('评价标识无效');
    return socialJson({
      review: await db.getPublicReview(
        { profileId, title_norm, year },
        guard.username,
      ),
    });
  } catch (error) {
    return socialFailure(error);
  }
}
