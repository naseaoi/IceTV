import { cookies } from 'next/headers';

import {
  type ListCountCookieName,
  parseListCountCookie,
} from '@/lib/list-count-cookies';

export async function peekListCountCookie(
  name: ListCountCookieName,
): Promise<number | null> {
  const cookieStore = await cookies();
  return parseListCountCookie(cookieStore.get(name)?.value);
}

// 缺少记录按 0 处理：新账号直接得到空状态骨架，已有数据的账号只在新设备首次进入时多闪一次
export async function getListSkeletonCount(
  name: ListCountCookieName,
  limit = Number.POSITIVE_INFINITY,
): Promise<number> {
  return Math.min((await peekListCountCookie(name)) ?? 0, limit);
}
