'use client';

import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import { checkForUpdates, UpdateStatus } from '@/lib/version-check';

export const ROLE_TEXT: Record<string, string> = {
  owner: '站长',
  admin: '管理员',
  user: '用户',
};

export async function logout() {
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('注销请求失败:', error);
  }
  window.location.href = '/';
}

export function buildLoginHref(): string {
  const redirect = `${window.location.pathname}${window.location.search}`;
  return `/login?redirect=${encodeURIComponent(redirect)}`;
}

// 版本更新提醒只面向部署者（站长）
export function useHasUpdate(): boolean {
  const { session } = useAuthSession();
  const isOwner =
    session.status === 'authenticated' && session.role === 'owner';
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    checkForUpdates()
      .then((status) => {
        if (!cancelled) setHasUpdate(status === UpdateStatus.HAS_UPDATE);
      })
      .catch((error) => console.warn('版本检查失败:', error));
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  return isOwner && hasUpdate;
}
