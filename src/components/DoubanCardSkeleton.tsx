import { ImagePlaceholder } from '@/components/ImagePlaceholder';

const DoubanCardSkeleton = ({ video = false }: { video?: boolean }) => {
  return (
    <div className='w-full'>
      <div className='group relative flex w-full flex-col rounded-lg bg-transparent shadow-none'>
        <ImagePlaceholder aspectRatio='aspect-[2/3]' />

        <div
          className={`mt-2 flex items-center text-[13px] ${video ? 'h-[1.5em]' : 'h-5'}`}
        >
          <div className='skeleton h-3.5 w-3/4 rounded'></div>
        </div>
      </div>
    </div>
  );
};

export default DoubanCardSkeleton;
