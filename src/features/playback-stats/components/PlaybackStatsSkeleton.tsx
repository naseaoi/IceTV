const TOP_ITEM_LIMIT = 3;

function SectionHeaderSkeleton() {
  return (
    <div className='mb-4 flex items-center gap-2'>
      <div className='h-5 w-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      <div className='h-7 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
    </div>
  );
}

function StatsCardSkeleton() {
  return (
    <div className='h-full rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
      <div className='mb-3 flex items-center gap-2'>
        <div className='h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      </div>
      <div className='h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
    </div>
  );
}

function WeeklyChartSkeleton() {
  return (
    <div className='h-36 rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <div className='h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        </div>
        <div className='h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      </div>
      <div className='grid h-20 grid-cols-7 gap-2'>
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className='grid h-full min-w-0 grid-rows-[1fr_auto] items-end'
          >
            <div className='flex h-14 items-end'>
              <div
                className='w-full animate-pulse rounded-t bg-gray-200 dark:bg-gray-800'
                style={{ height: 12 + ((index * 11) % 44) }}
              />
            </div>
            <div className='mx-auto mt-2 h-4 w-8 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        ))}
      </div>
    </div>
  );
}

function TopContentSkeleton() {
  return (
    <div className='flex h-36 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
      <div className='mb-3 flex min-w-0 items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        </div>
        <div className='h-6 w-[88px] animate-pulse rounded border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800' />
      </div>
      <div className='min-w-0 space-y-2'>
        {Array.from({ length: TOP_ITEM_LIMIT }).map((_, index) => (
          <div
            key={index}
            className='flex min-w-0 items-center justify-between gap-3'
          >
            <div className='h-5 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-5 w-20 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlaybackStatsSkeleton() {
  return (
    <section className='mb-2'>
      <SectionHeaderSkeleton />
      <div className='grid min-w-0 gap-3 sm:grid-cols-2'>
        <StatsCardSkeleton />
        <StatsCardSkeleton />
      </div>
      <div className='mt-3 grid min-w-0 items-stretch gap-3 md:grid-cols-2'>
        <WeeklyChartSkeleton />
        <TopContentSkeleton />
      </div>
    </section>
  );
}
