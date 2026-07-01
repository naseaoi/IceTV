import { Search } from 'lucide-react';

import PageLayout from '@/components/PageLayout';

export default function SearchLoading() {
  return (
    <PageLayout activePath='/search'>
      <div className='mb-10 overflow-visible px-4 py-4 sm:px-10 sm:py-8'>
        <div className='mb-8'>
          <div className='mx-auto max-w-2xl'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <div className='flex h-12 items-center rounded-lg border border-gray-200/50 bg-gray-50/80 py-3 pl-10 pr-12 text-sm text-gray-400 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500'>
                搜索电影、电视剧...
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
