import { ImagePlaceholder } from '@/components/ImagePlaceholder';

const DoubanCardSkeleton = () => {
  return (
    <div className='w-full'>
      <div className='group relative flex w-full flex-col rounded-lg bg-transparent shadow-none'>
        <ImagePlaceholder aspectRatio='aspect-[2/3]' />

        <div className='mt-2 flex h-5 items-center'>
          <div className='h-3.5 w-3/4 animate-pulse rounded bg-gray-200/80 dark:bg-gray-800'></div>
        </div>
      </div>
    </div>
  );
};

export default DoubanCardSkeleton;
