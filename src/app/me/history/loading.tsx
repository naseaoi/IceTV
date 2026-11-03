import { PlaybackHistoryGridSkeleton } from '@/features/playback-stats/components/PlaybackHistoryLibrary';

export default function HistoryLoading() {
  return (
    <>
      <div className='mb-4 py-3'>
        <div className='skeleton h-9 w-full rounded-full sm:w-72' />
      </div>
      <PlaybackHistoryGridSkeleton />
    </>
  );
}
