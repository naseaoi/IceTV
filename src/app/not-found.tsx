import Link from 'next/link';

export default function NotFound() {
  return (
    <main className='flex min-h-screen items-center justify-center bg-white px-6 text-gray-900 dark:bg-gray-950 dark:text-gray-100'>
      <div className='w-full max-w-md space-y-5 text-center'>
        <div className='space-y-2'>
          <p className='text-sm font-medium text-gray-500 dark:text-gray-400'>
            404
          </p>
          <h1 className='text-2xl font-semibold'>页面不存在</h1>
          <p className='text-sm leading-6 text-gray-600 dark:text-gray-400'>
            请求的页面不存在或已被移除。
          </p>
        </div>
        <Link
          href='/'
          className='inline-flex rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-950 dark:hover:bg-gray-300'
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
