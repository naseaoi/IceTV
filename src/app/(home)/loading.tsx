import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import PageLayout from '@/components/PageLayout';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

function CapsuleSwitchSkeleton() {
  return (
    <div className='relative flex items-end'>
      <div className='absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gray-300/60 to-transparent dark:via-white/20' />

      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className='relative px-6 py-3'>
          <div className='flex items-center gap-2'>
            <div className='h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-5 w-10 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonRow({
  count,
  withSubtitle = false,
}: {
  count: number;
  withSubtitle?: boolean;
}) {
  return (
    <div className='relative'>
      <div className='scrollbar-hide flex space-x-7 overflow-x-auto py-1 pb-12 pl-1 pr-4 sm:py-2 sm:pb-14 sm:pr-6'>
        {Array.from({ length: count }).map((_, index) => (
          <HomePosterCardSkeleton key={index} withSubtitle={withSubtitle} />
        ))}
      </div>
    </div>
  );
}

function SkeletonSectionHeader() {
  return (
    <div className='mb-4 flex items-center justify-between'>
      <div className='h-7 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
    </div>
  );
}

export default async function HomeLoading() {
  const continueWatchingCount = await getContinueWatchingSkeletonCount();

  return (
    <PageLayout>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        {/* CapsuleSwitch 骨架 */}
        <div className='mb-4 flex justify-center'>
          <CapsuleSwitchSkeleton />
        </div>

        <div className='mx-auto max-w-[95%]'>
          {continueWatchingCount > 0 && (
            <section className='mb-4'>
              <SkeletonSectionHeader />
              <SkeletonRow count={continueWatchingCount} withSubtitle />
            </section>
          )}

          {/* 推荐区域骨架 */}
          <section className='mb-4'>
            <SkeletonSectionHeader />
            <SkeletonRow count={12} />
          </section>

          <section className='mb-4'>
            <SkeletonSectionHeader />
            <SkeletonRow count={12} />
          </section>

          <section className='mb-4'>
            <SkeletonSectionHeader />
            <SkeletonRow count={12} />
          </section>

          <section className='mb-4'>
            <SkeletonSectionHeader />
            <SkeletonRow count={12} />
          </section>
        </div>
      </div>
    </PageLayout>
  );
}
