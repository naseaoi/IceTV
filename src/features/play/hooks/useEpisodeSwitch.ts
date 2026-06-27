import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
} from 'react';

import { SearchResult } from '@/lib/types';

import type { SourceSwitchEpisodeAnchor } from '@/features/play/lib/episodeResumePolicy';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';

interface UseEpisodeSwitchOptions {
  detailRef: RefObject<SearchResult | null>;
  currentEpisodeIndexRef: RefObject<number>;
  resumeTimeRef: RefObject<number | null>;
  resumeModeRef: RefObject<ResumeMode>;
  stableCurrentTimeRef: RefObject<number>;
  clearTargetEpisodeProgressRef: RefObject<boolean>;
  sourceSwitchEpisodeAnchorRef: RefObject<SourceSwitchEpisodeAnchor | null>;
  playbackRequestModeRef: RefObject<PlaybackRequestMode>;
  doSaveCurrentProgress: () => void | Promise<unknown>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setVideoLoadingStage: Dispatch<SetStateAction<'initing' | 'sourceChanging'>>;
  setVideoLoadingAttempt: Dispatch<SetStateAction<number>>;
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
}

interface EpisodeSwitchHandlers {
  switchEpisode: (targetEpisodeIndex: number) => void;
  handleEpisodeChange: (episodeNumber: number) => void;
  handlePreviousEpisode: () => void;
  handleNextEpisode: () => void;
}

export function useEpisodeSwitch({
  detailRef,
  currentEpisodeIndexRef,
  resumeTimeRef,
  resumeModeRef,
  stableCurrentTimeRef,
  clearTargetEpisodeProgressRef,
  sourceSwitchEpisodeAnchorRef,
  playbackRequestModeRef,
  doSaveCurrentProgress,
  setIsVideoLoading,
  setVideoLoadingStage,
  setVideoLoadingAttempt,
  setCurrentEpisodeIndex,
}: UseEpisodeSwitchOptions): EpisodeSwitchHandlers {
  const switchEpisode = useCallback(
    (targetEpisodeIndex: number) => {
      const d = detailRef.current;
      if (!d?.episodes || targetEpisodeIndex < 0) {
        return;
      }

      if (targetEpisodeIndex >= d.episodes.length) {
        return;
      }

      if (targetEpisodeIndex === currentEpisodeIndexRef.current) {
        return;
      }

      doSaveCurrentProgress();
      sourceSwitchEpisodeAnchorRef.current = null;
      playbackRequestModeRef.current = 'episode';
      clearTargetEpisodeProgressRef.current = true;
      stableCurrentTimeRef.current = 0;
      resumeTimeRef.current = 0;
      resumeModeRef.current = null;
      currentEpisodeIndexRef.current = targetEpisodeIndex;

      setIsVideoLoading(true);
      setVideoLoadingStage('sourceChanging');
      setVideoLoadingAttempt((prev) => prev + 1);
      setCurrentEpisodeIndex(targetEpisodeIndex);
    },
    [
      detailRef,
      currentEpisodeIndexRef,
      resumeTimeRef,
      resumeModeRef,
      stableCurrentTimeRef,
      clearTargetEpisodeProgressRef,
      sourceSwitchEpisodeAnchorRef,
      playbackRequestModeRef,
      doSaveCurrentProgress,
      setIsVideoLoading,
      setVideoLoadingStage,
      setVideoLoadingAttempt,
      setCurrentEpisodeIndex,
    ],
  );

  const handleEpisodeChange = useCallback(
    (episodeNumber: number) => {
      switchEpisode(episodeNumber);
    },
    [switchEpisode],
  );

  const handlePreviousEpisode = useCallback(() => {
    switchEpisode(currentEpisodeIndexRef.current - 1);
  }, [switchEpisode, currentEpisodeIndexRef]);

  const handleNextEpisode = useCallback(() => {
    switchEpisode(currentEpisodeIndexRef.current + 1);
  }, [switchEpisode, currentEpisodeIndexRef]);

  return {
    switchEpisode,
    handleEpisodeChange,
    handlePreviousEpisode,
    handleNextEpisode,
  };
}
