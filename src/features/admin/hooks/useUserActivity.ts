'use client';

import { useCallback, useEffect, useState } from 'react';

import { adminGet } from '@/features/admin/lib/api';

type UserActivityResult = {
  lastActiveAt: Record<string, number>;
};

export function useUserActivity() {
  const [lastActiveAt, setLastActiveAt] = useState<Record<string, number>>({});

  const refreshActivity = useCallback(async () => {
    try {
      const data = await adminGet<UserActivityResult>(
        '/api/admin/user/activity',
        '获取活跃时间失败',
      );
      setLastActiveAt(data.lastActiveAt || {});
    } catch {
      setLastActiveAt({});
    }
  }, []);

  useEffect(() => {
    void refreshActivity();
  }, [refreshActivity]);

  return { lastActiveAt, refreshActivity };
}
