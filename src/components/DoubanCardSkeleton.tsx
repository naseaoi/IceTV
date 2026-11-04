import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';

const DoubanCardSkeleton = ({ video = false }: { video?: boolean }) => (
  <HomePosterCardSkeleton
    className='w-full'
    variant={video ? 'video' : 'poster'}
  />
);

export default DoubanCardSkeleton;
