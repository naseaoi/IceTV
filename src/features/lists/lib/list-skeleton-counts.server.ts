import 'server-only';

import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';
import { db } from '@/lib/db';

// 骨架条数只是首屏体验优化，任何失败都退回 null，由客户端按未知处理
async function viewerOrUnknown(): Promise<string | null | undefined> {
  const cookieStore = await cookies();
  const session = await getServerAuthSession(cookieStore.get('auth')?.value);
  if (session.status === 'error') return undefined;
  return session.status === 'authenticated' ? session.username : null;
}

export async function getPlazaSkeletonCount(): Promise<number | null> {
  try {
    const viewer = await viewerOrUnknown();
    if (viewer === undefined) return null;
    return await db.countPlazaLists(viewer);
  } catch (error) {
    console.error('读取片单广场计数失败', error);
    return null;
  }
}

export async function getListDetailSkeletonCount(
  id: string,
): Promise<number | null> {
  try {
    const viewer = await viewerOrUnknown();
    if (viewer === undefined) return null;
    return await db.getListItemCount(id, viewer);
  } catch (error) {
    console.error('读取片单条目计数失败', error);
    return null;
  }
}
