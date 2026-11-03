import { PlaybackHistoryGridSkeleton } from '@/features/playback-stats/components/PlaybackHistoryLibrary';

export default function HistoryLoading() {
  return (
    <>
      <div className='mb-4 py-3'>
        <div className='h-9 w-full animate-pulse rounded-full bg-gray-200/70 dark:bg-white/[0.06] sm:w-72' />
      </div>
      <PlaybackHistoryGridSkeleton />
    </>
  );
}
