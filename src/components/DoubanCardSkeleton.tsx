import { ImagePlaceholder } from '@/components/ImagePlaceholder';

const DoubanCardSkeleton = () => {
  return (
    <div className='w-full'>
      <div className='group relative flex w-full flex-col rounded-lg bg-transparent shadow-none'>
        <ImagePlaceholder aspectRatio='aspect-[2/3]' />

        <div className='mt-2 flex h-5 flex-col items-center justify-center'>
          <div className='h-4 w-24 animate-pulse rounded bg-gray-200 sm:w-32'></div>
        </div>
      </div>
    </div>
  );
};

export default DoubanCardSkeleton;
