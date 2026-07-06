'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import {
  buildClientErrorReport,
  reportClientError,
} from '@/lib/client-error-reporting';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const details = isDevelopment
    ? buildClientErrorReport('页面渲染失败', error)
    : null;

  useEffect(() => {
    reportClientError({
      context: '页面渲染失败',
      error,
    });
  }, [error]);

  return (
    <main className='flex min-h-screen items-center justify-center bg-white px-6 text-gray-900 dark:bg-gray-950 dark:text-gray-100'>
      <div className='w-full max-w-md space-y-5 text-center'>
        <div className='space-y-2'>
          <h1 className='text-2xl font-semibold'>页面加载失败</h1>
          <p className='text-sm leading-6 text-gray-600 dark:text-gray-400'>
            当前页面出现错误，请重新加载。
          </p>
        </div>
        {details && (
          <div className='max-h-72 overflow-auto rounded-md border border-red-200 bg-red-50 p-3 text-left text-xs leading-5 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100'>
            <div>错误类型：{details.name || 'Unknown'}</div>
            <div>错误信息：{details.message}</div>
            {details.digest && <div>错误编号：{details.digest}</div>}
            {details.stack && (
              <pre className='mt-2 whitespace-pre-wrap break-words'>
                {details.stack}
              </pre>
            )}
          </div>
        )}
        <div className='flex justify-center gap-3'>
          <button
            type='button'
            onClick={reset}
            className='rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-950 dark:hover:bg-gray-300'
          >
            重新加载
          </button>
          <Link
            href='/'
            className='rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900'
          >
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
