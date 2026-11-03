import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';

export function SearchHistorySkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden='true'>
      <div className='mb-3 h-5 w-16 animate-pulse rounded bg-gray-200/80 dark:bg-white/[0.08]' />
      <div className='flex flex-wrap gap-2'>
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className='h-9 w-20 animate-pulse rounded-full bg-gray-200/80 dark:bg-white/[0.08]'
          />
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
          <div className='h-11 w-full rounded-full bg-white ring-1 ring-gray-900/[0.08] dark:bg-white/[0.06] dark:ring-white/10' />
        </div>
      </div>
      <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-5 md:pt-8`}>
        <SearchHistorySkeleton count={5} />
      </div>
    </PageLayout>
  );
}
