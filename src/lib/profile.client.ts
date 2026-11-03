import { fetchWithAuth } from '@/lib/db.client.internal';
import type {
  FollowListPage,
  PublicFavoritePage,
  PublicUserRef,
  PublicVideoReviewPage,
  UserProfileView,
} from '@/lib/types';

export const PROFILE_REQUIRED_EVENT = 'auth:profile-required';
export type MyProfile = PublicUserRef & { favoritesPublic: boolean };

export async function socialRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  let response = await fetch(url, { ...init, credentials: 'same-origin' });
  let data = await response.json().catch(() => null);
  if (response.status === 403 && data?.code === 'NICKNAME_REQUIRED') {
    window.dispatchEvent(new Event(PROFILE_REQUIRED_EVENT));
    throw new Error(data.error);
  }
  // 其余 401/403 视为会话可能失效（封禁、删号），交给统一鉴权恢复；社交写接口均幂等，可重放
  if (response.status === 401 || response.status === 403) {
    response = await fetchWithAuth(url, init);
    data = await response.json().catch(() => null);
  }
  if (!data) throw new Error('服务器响应异常，请稍后重试');
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试');
  return data as T;
}

export function getMyProfile() {
  return socialRequest<MyProfile>('/api/profile');
}
export function updateProfile(input: {
  nickname?: string;
  favoritesPublic?: boolean;
}) {
  return socialRequest<MyProfile>('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
export function getUserProfile(profileId: string) {
  return socialRequest<UserProfileView>(
    `/api/users/${encodeURIComponent(profileId)}`,
  );
}
function userPageUrl(profileId: string, kind: string, cursor?: string | null) {
  return `/api/users/${encodeURIComponent(profileId)}/${kind}?${new URLSearchParams(cursor ? { cursor } : {})}`;
}
export function getUserReviews(profileId: string, cursor?: string | null) {
  return socialRequest<PublicVideoReviewPage>(
    userPageUrl(profileId, 'reviews', cursor),
  );
}
export function getUserFavorites(profileId: string, cursor?: string | null) {
  return socialRequest<PublicFavoritePage>(
    userPageUrl(profileId, 'favorites', cursor),
  );
}
export function getUserFollows(
  profileId: string,
  type: 'followers' | 'following',
  cursor?: string | null,
) {
  return socialRequest<FollowListPage>(
    `${userPageUrl(profileId, 'follows', cursor)}&type=${type}`,
  );
}
export function setFollowing(profileId: string, following: boolean) {
  return socialRequest<{ following: boolean; followerCount: number }>(
    following
      ? '/api/follows'
      : `/api/follows?${new URLSearchParams({ profileId })}`,
    {
      method: following ? 'PUT' : 'DELETE',
      ...(following
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId }),
          }
        : {}),
    },
  );
}
