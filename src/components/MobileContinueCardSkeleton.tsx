export default function MobileContinueCardSkeleton() {
  return (
    <div
      aria-hidden='true'
      data-mobile-continue-skeleton
      className='relative h-[120px] w-[232px] shrink-0 animate-pulse overflow-hidden rounded-xl border border-gray-200/60 bg-white dark:border-gray-700/60 dark:bg-gray-800/60'
    >
      <div className='flex h-full'>
        <div className='h-full w-[80px] shrink-0 bg-gray-200 dark:bg-gray-700' />
        <div className='flex min-w-0 flex-1 flex-col justify-between p-2.5 pb-3'>
          <div className='min-w-0 space-y-1.5'>
            <div className='h-3.5 w-full rounded bg-gray-200 dark:bg-gray-700' />
            <div className='h-3.5 w-3/4 rounded bg-gray-200 dark:bg-gray-700' />
            <div className='h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700' />
          </div>
          <div className='h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700' />
        </div>
        <div className='flex h-10 w-8 shrink-0 items-start justify-center pt-2'>
          <div className='h-4 w-1 rounded-full bg-gray-200 dark:bg-gray-700' />
        </div>
      </div>
      <div className='absolute bottom-0 left-[80px] right-0 h-[3px] bg-gray-200 dark:bg-gray-700'>
        <div className='h-full w-1/3 bg-gray-300 dark:bg-gray-600' />
      </div>
    </div>
  );
}
