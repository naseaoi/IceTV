import { Check } from 'lucide-react';

import type { EpisodeProgressView } from '@/features/play/lib/episodeProgress';

export function getEpisodeProgressLabel(
  progress: EpisodeProgressView | null | undefined,
): string {
  if (!progress) return '';
  return progress.finished
    ? '已看完'
    : `看到 ${Math.round(progress.ratio * 100)}%`;
}

/**
 * 选集按钮的观看进度：按钮底色从左铺到已看比例，看完铺满并加角标。
 * 宿主按钮需 relative overflow-hidden，按钮文字需 relative 以压在底色之上。
 * 当前集由播放器展示进度，只保留看完角标。
 */
export function EpisodeProgressMark({
  progress,
  active,
}: {
  progress: EpisodeProgressView | null | undefined;
  active: boolean;
}) {
  if (!progress) return null;
  return (
    <>
      {!active && (
        <span
          aria-hidden
          className='pointer-events-none absolute inset-y-0 left-0 bg-brand-500/[0.14] dark:bg-white/[0.08]'
          style={{
            width: progress.finished
              ? '100%'
              : `${Math.max(10, Math.round(progress.ratio * 100))}%`,
          }}
        />
      )}
      {progress.finished && (
        <Check
          aria-hidden
          strokeWidth={3}
          className={`pointer-events-none absolute right-1 top-1 h-2.5 w-2.5 ${
            active ? 'text-white/80' : 'text-brand-500 dark:text-gray-500'
          }`}
        />
      )}
    </>
  );
}
