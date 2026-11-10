'use client';

import { useEffect } from 'react';

import { getLinuxDoErrorMessage } from '@/lib/linuxdo-errors';
import { showToast } from '@/lib/toast';

const PARAM = 'linuxdo_bind';

export function LinuxDoBindNotifier() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get(PARAM);
    if (!result) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(null, '', url);
    if (result === 'ok') {
      showToast('已绑定 LinuxDo 账号', 'success');
    } else {
      showToast(
        getLinuxDoErrorMessage(result) ?? 'LinuxDo 绑定失败，请稍后重试',
        'error',
      );
    }
  }, []);
  return null;
}
