'use client';

import { useEffect } from 'react';

import { reportClientError } from '@/lib/client-error-reporting';

export function ClientErrorReporter() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      reportClientError({
        context: '浏览器运行时错误',
        error: event.error || event.message,
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportClientError({
        context: '未处理的 Promise 拒绝',
        error: event.reason,
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection,
      );
    };
  }, []);

  return null;
}
