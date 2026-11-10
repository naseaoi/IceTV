import { PROFILE_REQUIRED_EVENT } from '@/lib/profile.client';
import type { AdminReviewReportPage } from '@/lib/types';

type ErrorPayload = {
  error?: string;
  code?: string;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function resolveErrorMessage(
  response: Response,
  fallbackPrefix: string,
): Promise<string> {
  const payload = await parseJsonSafely<ErrorPayload>(response);
  if (response.status === 403 && payload?.code === 'NICKNAME_REQUIRED')
    window.dispatchEvent(new Event(PROFILE_REQUIRED_EVENT));
  if (payload?.error) {
    return payload.error;
  }
  return `${fallbackPrefix}: ${response.status}`;
}

export async function adminGet<T>(
  endpoint: string,
  fallbackPrefix = '请求失败',
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });

  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response, fallbackPrefix));
  }

  const payload = await parseJsonSafely<T>(response);
  return (payload ?? ({} as T)) as T;
}

export async function adminDelete(
  endpoint: string,
  body: Record<string, unknown>,
  fallbackPrefix = '删除失败',
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response, fallbackPrefix));
  }
}

export async function adminPost<T = Record<string, unknown>>(
  endpoint: string,
  body?: Record<string, unknown>,
  fallbackPrefix = '操作失败',
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response, fallbackPrefix));
  }

  const payload = await parseJsonSafely<T>(response);
  return (payload ?? ({} as T)) as T;
}

export async function adminPatch<T = Record<string, unknown>>(
  endpoint: string,
  body: Record<string, unknown>,
  fallbackPrefix = '操作失败',
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response, fallbackPrefix));
  }

  const payload = await parseJsonSafely<T>(response);
  return (payload ?? ({} as T)) as T;
}

export function getAdminReviewReports(cursor?: string | null) {
  return adminGet<AdminReviewReportPage>(
    `/api/admin/reviews/reports${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`,
    '加载举报失败',
  );
}
export function moderateReviewReport(input: {
  action: 'dismiss' | 'mark-spoiler' | 'delete-review' | 'delete-reply';
  replyId?: string;
  username: string;
  title_norm: string;
  year: string;
}) {
  return adminPost('/api/admin/reviews/reports', input, '处理举报失败');
}
