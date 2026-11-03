// 尺寸与 ContinueCard 一致
export default function ContinueWatchingCardSkeleton() {
  return (
    <div
      aria-hidden='true'
      data-continue-skeleton
      className='relative h-[120px] w-[232px] shrink-0 animate-pulse overflow-hidden rounded-xl bg-white ring-1 ring-gray-200/80 dark:bg-white/[0.04] dark:ring-white/10 md:h-[136px] md:w-[340px]'
    >
      <div className='flex h-full'>
        <div className='h-full w-[80px] shrink-0 bg-gray-200 dark:bg-white/[0.08] md:w-[91px]' />
        <div className='flex min-w-0 flex-1 flex-col justify-between p-2.5 pb-3 md:p-3.5 md:pb-4'>
          <div className='min-w-0 space-y-1.5'>
            <div className='h-3.5 w-3/4 rounded bg-gray-200 dark:bg-white/[0.08]' />
            <div className='h-3 w-2/3 rounded bg-gray-200 dark:bg-white/[0.08]' />
            <div className='h-3 w-1/2 rounded bg-gray-200 dark:bg-white/[0.08]' />
          </div>
          <div className='h-3 w-1/2 rounded bg-gray-200 dark:bg-white/[0.08] md:h-7 md:w-28 md:rounded-full' />
        </div>
      </div>
    </div>
  );
}
