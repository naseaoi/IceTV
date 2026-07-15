import { LoaderCircle } from 'lucide-react';

export function DoubanFeedLoading() {
  return (
    <div
      data-douban-feed-loading
      className='flex min-h-[50vh] items-center justify-center'
      role='status'
    >
      <div className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
        <LoaderCircle className='h-5 w-5 animate-spin' aria-hidden='true' />
        <span>正在加载内容...</span>
      </div>
    </div>
  );
}
