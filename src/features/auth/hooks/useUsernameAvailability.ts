'use client';

import { useEffect, useState } from 'react';

const DEBOUNCE_MS = 400;

export type UsernameAvailabilityStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'taken'
  | 'error';

export interface UsernameAvailability {
  status: UsernameAvailabilityStatus;
  message: string | null;
}

interface UseUsernameAvailabilityOptions {
  username: string;
  enabled: boolean;
}

export function useUsernameAvailability({
  username,
  enabled,
}: UseUsernameAvailabilityOptions): UsernameAvailability {
  const [state, setState] = useState<UsernameAvailability>({
    status: 'idle',
    message: null,
  });

  useEffect(() => {
    if (!enabled || !username) {
      setState({ status: 'idle', message: null });
      return;
    }

    setState({ status: 'checking', message: null });

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/register/check-username?username=${encodeURIComponent(username)}`,
          { signal: controller.signal },
        );
        const data = (await res.json()) as {
          available?: boolean;
          error?: string;
        };

        if (controller.signal.aborted) {
          return;
        }

        if (!res.ok) {
          setState({
            status: 'error',
            message: data.error || '用户名检测失败',
          });
          return;
        }

        setState(
          data.available
            ? { status: 'available', message: '该用户名可以使用' }
            : { status: 'taken', message: data.error || '用户名已被占用' },
        );
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          return;
        }
        setState({ status: 'error', message: '用户名检测失败' });
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [username, enabled]);

  return state;
}
