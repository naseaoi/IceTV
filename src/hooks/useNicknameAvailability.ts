'use client';

import { useEffect, useState } from 'react';

import { validateNickname } from '@/lib/user-profile';

type Availability = {
  value: string;
  status: 'idle' | 'checking' | 'available' | 'error';
  message: string;
};
export function useNicknameAvailability(nickname: string, enabled = true) {
  const [state, setState] = useState<Availability>({
    value: '',
    status: 'idle',
    message: '',
  });
  useEffect(() => {
    if (!enabled || !nickname) {
      setState({ value: nickname, status: 'idle', message: '' });
      return;
    }
    try {
      validateNickname(nickname);
    } catch (error) {
      setState({
        value: nickname,
        status: 'error',
        message: (error as Error).message,
      });
      return;
    }
    setState({ value: nickname, status: 'checking', message: '正在检测昵称…' });
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/profile/nickname-availability?${new URLSearchParams({ nickname })}`,
          { signal: controller.signal },
        );
        const result = await response.json();
        if (!controller.signal.aborted)
          setState({
            value: nickname,
            status: response.ok && result.available ? 'available' : 'error',
            message:
              response.ok && result.available
                ? '该昵称可以使用'
                : result.error || '昵称检测失败',
          });
      } catch {
        if (!controller.signal.aborted)
          setState({
            value: nickname,
            status: 'error',
            message: '昵称检测失败，请重新输入',
          });
      }
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [nickname, enabled]);
  if (!enabled || !nickname) {
    return { value: nickname, status: 'idle' as const, message: '' };
  }
  return state.value === nickname
    ? state
    : {
        value: nickname,
        status: 'checking' as const,
        message: '正在检测昵称…',
      };
}
