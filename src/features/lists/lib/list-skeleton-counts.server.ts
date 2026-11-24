import 'server-only';

import { cookies } from 'next/headers';

import type { ListHeaderPreview } from '@/features/lists/types';
import { getServerAuthSession } from '@/lib/auth-session.server';
import { db } from '@/lib/db';

import {
  getBlockedListSources,
  visibleListItems,
} from './list-content-policy.server';

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

export async function getListDetailPreview(
  id: string,
): Promise<ListHeaderPreview | null> {
  try {
    const viewer = await viewerOrUnknown();
    if (viewer === undefined) return null;
    const blocked = await getBlockedListSources();
    if (blocked.size > 0) {
      const { list, items } = await db.getList(id, viewer);
      return {
        name: list.name,
        description: list.description,
        itemCount: visibleListItems(items, blocked).length,
      };
    }
    return await db.getListHeaderPreview(id, viewer);
  } catch (error) {
    console.error('读取片单概要失败', error);
    return null;
  }
}
