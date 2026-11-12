'use client';

import { useEffect, useRef, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import { showToast } from '@/lib/toast';
import {
  DisplayableError,
  getErrorMessage,
  getHttpErrorMessage,
  isAbortError,
} from '@/lib/user-facing-error';
import { checkForUpdates, UpdateStatus } from '@/lib/version-check';

export const ROLE_TEXT: Record<string, string> = {
  owner: '站长',
  admin: '管理员',
  user: '用户',
};

export async function logout() {
  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new DisplayableError(
        typeof data?.error === 'string'
          ? data.error
          : getHttpErrorMessage(response.status, '退出失败，请重试'),
      );
    }
    window.location.href = '/';
  } catch (error) {
    if (!isAbortError(error))
      showToast(getErrorMessage(error, '退出失败，请重试'), 'error');
  }
}

export function useLogout() {
  const [loggingOut, setLoggingOut] = useState(false);
  const pending = useRef(false);
  const handleLogout = async () => {
    if (pending.current) return;
    pending.current = true;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      pending.current = false;
      setLoggingOut(false);
    }
  };
  return { loggingOut, handleLogout };
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
