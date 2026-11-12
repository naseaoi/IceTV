import type { NextResponse } from 'next/server';

// 列表条数快照，供路由 loading 在服务端按真实条数渲染骨架；不区分账号，登录与退出时统一清除
export const LIST_COUNT_COOKIE_NAMES = [
  'fav_count',
  'cw_count',
  'cw_page_count',
  'review_count',
  'history_count',
  'list_count',
] as const;

export type ListCountCookieName = (typeof LIST_COUNT_COOKIE_NAMES)[number];

const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function parseListCountCookie(raw: string | undefined): number | null {
  if (!raw) return null;
  const count = Number(raw);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;
}

export function readListCountCookie(name: ListCountCookieName): number | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const entry = document.cookie
    .split('; ')
    .find((part) => part.startsWith(prefix));
  return parseListCountCookie(entry?.slice(prefix.length));
}

export function writeListCountCookie(
  name: ListCountCookieName,
  value: number,
): void {
  if (typeof document === 'undefined') return;
  const count = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  try {
    document.cookie = `${name}=${count};path=/;max-age=${MAX_AGE_SECONDS};samesite=lax`;
  } catch {}
}

export function clearListCountCookie(name: ListCountCookieName): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${name}=0;path=/;max-age=0;samesite=lax`;
  } catch {}
}

export function clearListCountCookiesOnResponse(response: NextResponse): void {
  for (const name of LIST_COUNT_COOKIE_NAMES) {
    response.cookies.set(name, '', {
      path: '/',
      expires: new Date(0),
      sameSite: 'lax',
    });
  }
}
