export function PlaybackHistoryItemSkeleton() {
  return (
    <div className='flex w-full min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white/70 p-3 dark:border-gray-700 dark:bg-gray-900/50'>
      <div className='h-14 w-10 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      <div className='min-w-0 flex-1'>
        <div className='h-5 w-3/5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1'>
          <div className='h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-1'>
        <div className='h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        <div className='h-5 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      </div>
    </div>
  );
}

export function PlaybackHistorySkeleton({ count = 6 }: { count?: number }) {
  return (
    <section className='mb-2'>
      <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex items-center gap-2'>
          <div className='h-5 w-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-7 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        </div>
        <div className='h-10 w-full animate-pulse rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 sm:w-72' />
      </div>
      <div className='min-h-[296px] space-y-2'>
        {Array.from({ length: count }).map((_, index) => (
          <PlaybackHistoryItemSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}
