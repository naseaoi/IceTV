import { cookies } from 'next/headers';

import {
  type ListCountCookieName,
  parseListCountCookie,
} from '@/lib/list-count-cookies';

// 缺少记录按 0 处理：新账号直接得到空状态骨架，已有数据的账号只在新设备首次进入时多闪一次
export async function getListSkeletonCount(
  name: ListCountCookieName,
  limit = Number.POSITIVE_INFINITY,
): Promise<number> {
  const cookieStore = await cookies();
  const count = parseListCountCookie(cookieStore.get(name)?.value) ?? 0;
  return Math.min(count, limit);
}
