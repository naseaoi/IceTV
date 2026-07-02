'use client';

import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('全局渲染失败:', error);

  return (
    <html lang='zh-CN'>
      <body>
        <main className='flex min-h-screen items-center justify-center bg-white px-6 text-gray-900 dark:bg-gray-950 dark:text-gray-100'>
          <div className='w-full max-w-md space-y-5 text-center'>
            <div className='space-y-2'>
              <h1 className='text-2xl font-semibold'>应用加载失败</h1>
              <p className='text-sm leading-6 text-gray-600 dark:text-gray-400'>
                当前应用出现错误，请重新加载。
              </p>
            </div>
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
      </body>
    </html>
  );
}
