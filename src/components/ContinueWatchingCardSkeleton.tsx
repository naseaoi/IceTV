// 尺寸与 ContinueCard 一致
export default function ContinueWatchingCardSkeleton() {
  return (
    <div
      aria-hidden='true'
      data-continue-skeleton
      className='flex w-[236px] shrink-0 gap-3 md:w-[288px]'
    >
      <div className='skeleton aspect-[2/3] w-[76px] shrink-0 self-start rounded-lg md:w-[88px]' />
      <div className='flex min-w-0 flex-1 flex-col py-1'>
        <div className='flex h-[1.375em] items-center text-[13px] md:text-sm'>
          <div className='skeleton h-3.5 w-3/4 rounded' />
        </div>
        <div className='mt-1 space-y-0.5'>
          <div className='flex h-4 items-center'>
            <div className='skeleton h-3 w-1/2 rounded' />
          </div>
          <div className='flex h-4 items-center'>
            <div className='skeleton h-3 w-1/3 rounded' />
          </div>
        </div>
        <div className='mt-auto pt-2'>
          <div className='flex h-[1.5em] items-center justify-between text-[11px]'>
            <div className='skeleton h-2.5 w-1/2 rounded' />
            <div className='skeleton h-2.5 w-6 rounded' />
          </div>
          <div className='skeleton mt-1 h-1 w-full rounded-full' />
        </div>
      </div>
    </div>
  );
}
