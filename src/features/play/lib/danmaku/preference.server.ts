import 'server-only';

import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';
import { db } from '@/lib/db';

export async function getInitialDanmakuEnabled(): Promise<boolean | null> {
  try {
    const cookieStore = await cookies();
    const session = await getServerAuthSession(cookieStore.get('auth')?.value);
    if (session.status !== 'authenticated') return null;
    return db.getDanmakuEnabledPreference(session.username);
  } catch (error) {
    console.error('读取账号弹幕设置失败:', error);
    return null;
  }
}
