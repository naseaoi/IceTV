import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';

export function SearchHistorySkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden='true'>
      <div className='mb-3 flex h-[27.5px] items-center'>
        <div className='skeleton h-4 w-16 rounded' />
      </div>
      <div className='flex flex-wrap gap-2'>
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className='skeleton h-9 w-20 rounded-full' />
        ))}
      </div>
    </div>
  );
}

export function SearchPageSkeleton() {
  return (
    <PageLayout activePath='/search' mobileHeader={false}>
      <div
        className='sticky top-0 z-30 border-b border-gray-200/70 bg-gray-50/85 backdrop-blur-xl dark:border-white/[0.06] dark:bg-gray-950/80 md:top-16 lg:hidden'
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className={`${PAGE_CONTAINER_CLASS} py-2.5`}>
          <div className='skeleton h-11 w-full rounded-full ring-1 ring-gray-900/[0.08] dark:ring-white/10' />
        </div>
      </div>
      <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-5 md:pt-8`}>
        <SearchHistorySkeleton />
      </div>
    </PageLayout>
  );
}
