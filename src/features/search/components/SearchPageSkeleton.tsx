import { Search } from 'lucide-react';

import PageLayout from '@/components/PageLayout';

export function SearchPageSkeleton() {
  return (
    <PageLayout activePath='/search'>
      <div className='overflow-visible px-4 pb-4 pt-0 sm:px-10 sm:py-8'>
        <div className='pt-0 md:pt-[20vh]'>
          <div
            className='sticky top-0 z-[550] -mx-4 border-b border-gray-200/50 bg-white/80 px-4 py-2 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/80 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none md:dark:bg-transparent'
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
          >
            <div className='mx-auto w-full max-w-2xl'>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
                <div className='h-12 w-full rounded-lg border border-gray-200/50 bg-gray-50/80 shadow-sm dark:border-gray-700 dark:bg-gray-800' />
              </div>
            </div>
          </div>

          <div className='mx-auto mt-8 h-[120px] w-full max-w-2xl'>
            <div className='mx-auto mb-4 h-7 w-24 animate-pulse rounded-md bg-gray-200/80 dark:bg-white/[0.08]' />
            <div className='flex flex-wrap justify-center gap-2'>
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className='h-9 w-20 animate-pulse rounded-full bg-gray-200/80 dark:bg-white/[0.08]'
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
