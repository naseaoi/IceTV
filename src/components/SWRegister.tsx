'use client';

import { useEffect } from 'react';

import { cleanupDevelopmentServiceWorker } from '@/lib/service-worker.client';

export function SWRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('SW 注册失败:', err);
      });
    } else {
      void cleanupDevelopmentServiceWorker()
        .then((shouldReload) => {
          if (shouldReload) window.location.reload();
        })
        .catch((err) => {
          console.warn('开发环境 SW 清理失败:', err);
        });
    }
  }, []);

  return null;
}
