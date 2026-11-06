import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { InvalidFavoriteLibraryQuery } from '@/features/favorites/lib/library-storage';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { isFavoriteWatchStatus } from '@/lib/catalog-favorites';
import { getClientIp } from '@/lib/client-ip';
import { db } from '@/lib/db';
import { FixedWindowRateLimiter } from '@/lib/fixed-window-rate-limit';
import { NicknameTakenError } from '@/lib/review-social-storage';
import type {
  LibraryVisibility,
  PublicFavoriteItem,
  UserProfile,
} from '@/lib/types';
import {
  ProfileValidationError,
  validateAvatarSeed,
  validateLibraryVisibility,
  validateNickname,
} from '@/lib/user-profile';
import { normalizeUsername } from '@/lib/username';
import { ReviewValidationError } from '@/lib/video-reviews';

const nicknameLimiter = new FixedWindowRateLimiter(30, 60_000);

export function socialJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function socialFailure(error: unknown) {
  if (error instanceof NicknameTakenError)
    return socialJson({ error: '昵称已被使用' }, 409);
  if (
    error instanceof ReviewValidationError ||
    error instanceof ProfileValidationError ||
    error instanceof InvalidFavoriteLibraryQuery
  )
    return socialJson({ error: error.message }, 400);
  console.error('用户社交操作失败', error);
  return socialJson({ error: '操作失败，请稍后重试' }, 500);
}

export async function socialBody(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ReviewValidationError('请求体必须为有效 JSON 对象');
  }
}

export async function requireNickname(
  username: string,
): Promise<NextResponse | null> {
  const profile = await db.ensureUserProfile(normalizeUsername(username));
  return profile.nickname
    ? null
    : socialJson({ error: '请先设置昵称', code: 'NICKNAME_REQUIRED' }, 403);
}

function ownProfile(profile: UserProfile) {
  return {
    profileId: profile.profile_id,
    nickname: profile.nickname,
    avatarSeed: profile.avatar_seed,
    libraryVisibility: profile.favorites_public,
  };
}

export async function handleProfile(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    if (request.method === 'GET')
      return socialJson(ownProfile(await db.ensureUserProfile(guard.username)));
    const body = await socialBody(request);
    if (
      body.nickname === undefined &&
      body.favoritesPublic === undefined &&
      body.libraryVisibility === undefined &&
      body.avatarSeed === undefined
    )
      throw new ReviewValidationError('请提供要修改的资料');
    const patch: {
      nickname?: string;
      avatarSeed?: string | null;
      libraryVisibility?: LibraryVisibility;
    } = {};
    if (body.nickname !== undefined)
      patch.nickname = validateNickname(body.nickname, {
        allowReserved: guard.role === 'owner',
      }).nickname;
    if (body.avatarSeed !== undefined)
      patch.avatarSeed = validateAvatarSeed(body.avatarSeed);
    if (body.libraryVisibility !== undefined) {
      patch.libraryVisibility = validateLibraryVisibility(
        body.libraryVisibility,
      );
    } else if (body.favoritesPublic !== undefined) {
      if (typeof body.favoritesPublic !== 'boolean')
        throw new ReviewValidationError('收藏公开状态必须为布尔值');
      patch.libraryVisibility = body.favoritesPublic ? 1 : 0;
    }
    return socialJson(
      ownProfile(await db.updateUserProfile(guard.username, patch)),
    );
  } catch (error) {
    return socialFailure(error);
  }
}

export async function handleNicknameAvailability(request: NextRequest) {
  try {
    const verdict = nicknameLimiter.check(getClientIp(request));
    if (!verdict.allowed)
      return NextResponse.json(
        { error: '检测过于频繁，请稍后再试' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': String(verdict.retryAfterSeconds),
          },
        },
      );
    const guard = await requireActiveUser(request);
    const signedIn = !isGuardFailure(guard);
    let nickname: string;
    try {
      nickname = validateNickname(
        request.nextUrl.searchParams.get('nickname'),
        { allowReserved: signedIn && guard.role === 'owner' },
      ).nickname;
    } catch (error) {
      if (error instanceof ProfileValidationError)
        return socialJson({ available: false, error: error.message });
      throw error;
    }
    const available = await db.isNicknameAvailable(
      nickname,
      signedIn ? guard.username : undefined,
    );
    return socialJson(
      available
        ? { available: true }
        : { available: false, error: '昵称已被使用' },
    );
  } catch (error) {
    return socialFailure(error);
  }
}

export type ProfileRouteContext = { params: Promise<{ profileId: string }> };

export async function handlePublicUser(
  request: NextRequest,
  context: ProfileRouteContext,
  section: 'profile' | 'reviews' | 'favorites' | 'follows' = 'profile',
) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const { profileId } = await context.params;
    const profile = await db.getUserProfileById(profileId);
    if (!profile) return socialJson({ error: '用户不存在' }, 404);
    const cursor = request.nextUrl.searchParams.get('cursor') || undefined;
    if (section === 'profile')
      return socialJson(
        await db.getUserProfileView(profile.username, guard.username),
      );
    if (section === 'reviews')
      return socialJson(
        await db.getUserPublicReviewPage(
          profile.username,
          guard.username,
          cursor,
        ),
      );
    if (section === 'follows') {
      const type = request.nextUrl.searchParams.get('type');
      if (type !== 'followers' && type !== 'following')
        throw new ReviewValidationError('关注列表类型无效');
      return socialJson(
        await db.getUserFollowPage(profile.username, type, cursor),
      );
    }
    const isSelf = profile.username === normalizeUsername(guard.username);
    const libraryVisibility = isSelf ? 3 : profile.favorites_public;
    if (libraryVisibility === 0)
      return socialJson({ hidden: true, libraryVisibility });
    const filter = request.nextUrl.searchParams.get('filter') ?? 'all';
    if (
      filter !== 'all' &&
      (!isFavoriteWatchStatus(filter) || libraryVisibility < 2)
    )
      throw new ReviewValidationError('当前片单不支持此筛选');
    const page = await db.getFavoriteLibraryPage(profile.username, {
      query: '',
      filter: filter as 'all' | import('@/lib/types').FavoriteWatchStatus,
      sort: 'saved',
      cursor,
      profileScope: isSelf ? 'self' : 'public',
    });
    const items: PublicFavoriteItem[] = page.items.map(
      ({ key, favorite: f, watchStatus, myRating }) => ({
        key,
        title: f.title,
        year: f.year,
        cover: f.cover,
        source_name: f.source_name,
        total_episodes: f.total_episodes,
        search_title: f.search_title,
        save_time: f.save_time,
        ...(libraryVisibility >= 2 ? { watchStatus } : {}),
        ...(libraryVisibility >= 3 ? { rating: myRating } : {}),
      }),
    );
    return socialJson({
      hidden: false,
      libraryVisibility,
      items,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    return socialFailure(error);
  }
}

export async function handleFollows(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const nicknameFailure = await requireNickname(guard.username);
    if (nicknameFailure) return nicknameFailure;
    const profileId =
      request.method === 'DELETE'
        ? request.nextUrl.searchParams.get('profileId')
        : (await socialBody(request)).profileId;
    if (typeof profileId !== 'string' || !/^[A-Za-z0-9]{12}$/.test(profileId))
      throw new ReviewValidationError('用户标识无效');
    const profile = await db.getUserProfileById(profileId);
    if (!profile) return socialJson({ error: '用户不存在' }, 404);
    return socialJson(
      await db.setUserFollow(
        guard.username,
        profile.username,
        request.method === 'PUT',
      ),
    );
  } catch (error) {
    return socialFailure(error);
  }
}
