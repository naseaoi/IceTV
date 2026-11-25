import { cookies } from 'next/headers';

import { MyListsPageClient } from '@/features/lists/components/MyListsPageClient';
import { getServerAuthSession } from '@/lib/auth-session.server';
import { db } from '@/lib/db';
import { peekListCountCookie } from '@/lib/list-count-cookies.server';

// 未打开的标签不会请求列表，计数 cookie 缺失时由服务端补一次轻量计数，否则标签计数一直停在加载中。
async function resolveCounts(): Promise<[number | null, number | null]> {
  const [count, savedCount] = await Promise.all([
    peekListCountCookie('list_count'),
    peekListCountCookie('saved_list_count'),
  ]);
  if (count !== null && savedCount !== null) return [count, savedCount];
  const session = await getServerAuthSession(
    (await cookies()).get('auth')?.value,
  );
  if (session.status !== 'authenticated') return [count, savedCount];
  return Promise.all([
    count ?? db.countUserLists(session.username),
    savedCount ?? db.countSavedLists(session.username),
  ]);
}

export default async function MyListsPage() {
  const [count, savedCount] = await resolveCounts();
  return (
    <MyListsPageClient skeletonCount={count} savedSkeletonCount={savedCount} />
  );
}
