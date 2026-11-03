// 尺寸与 ContinueCard 一致
export default function ContinueWatchingCardSkeleton() {
  return (
    <div
      aria-hidden='true'
      data-continue-skeleton
      className='flex w-[236px] shrink-0 animate-pulse gap-3 md:w-[288px]'
    >
      <div className='aspect-[2/3] w-[76px] shrink-0 rounded-lg bg-gray-200 dark:bg-white/[0.08] md:w-[88px]' />
      <div className='flex min-w-0 flex-1 flex-col py-1'>
        <div className='h-3.5 w-3/4 rounded bg-gray-200 dark:bg-white/[0.08]' />
        <div className='mt-2 h-3 w-1/2 rounded bg-gray-200 dark:bg-white/[0.08]' />
        <div className='mt-1.5 h-3 w-1/3 rounded bg-gray-200 dark:bg-white/[0.08]' />
        <div className='mt-auto h-1 w-full rounded-full bg-gray-200 dark:bg-white/[0.08]' />
      </div>
    </div>
  );
}
