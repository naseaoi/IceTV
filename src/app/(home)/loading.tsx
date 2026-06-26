import PageLayout from '@/components/PageLayout';

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

function SkeletonCard({ withSubtitle = false }: { withSubtitle?: boolean }) {
  return (
    <div className='w-24 min-w-[96px] sm:w-44 sm:min-w-[180px]'>
      <div className='relative aspect-[2/3] w-full animate-pulse overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800'>
        <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700' />
      </div>
      <div className='mx-auto mt-2 h-5 w-4/5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      {withSubtitle && (
        <div className='mx-auto mt-1 h-[22px] w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      )}
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
      <div className='scrollbar-hide flex space-x-6 overflow-x-auto py-1 pb-12 pl-1 pr-4 sm:py-2 sm:pb-14 sm:pr-6'>
        {Array.from({ length: count }).map((_, index) => (
          <SkeletonCard key={index} withSubtitle={withSubtitle} />
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

export default function HomeLoading() {
  return (
    <PageLayout>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        {/* CapsuleSwitch 骨架 */}
        <div className='mb-4 flex justify-center'>
          <CapsuleSwitchSkeleton />
        </div>

        <div className='mx-auto max-w-[95%]'>
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
