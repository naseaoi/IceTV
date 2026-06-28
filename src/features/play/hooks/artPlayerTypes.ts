import type Artplayer from 'artplayer';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { SearchResult, SkipConfig } from '@/lib/types';

import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';
import type { WakeLockSentinel } from '@/features/play/lib/playTypes';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';

export type CurrentSourceVideoInfo = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
};

export type CurrentSourceVideoInfoContext = {
  source: string;
  id: string;
  videoUrl: string;
};

export interface UseArtPlayerParams {
  artRef: MutableRefObject<HTMLDivElement | null>;
  artPlayerRef: MutableRefObject<Artplayer | null>;
  videoUrl: string;
  videoCover: string;
  videoTitle: string;
  loading: boolean;
  detail: SearchResult | null;
  currentEpisodeIndex: number;
  totalEpisodes: number;
  blockAdEnabled: boolean;
  blockAdEnabledRef: MutableRefObject<boolean>;
  skipConfigRef: MutableRefObject<SkipConfig>;
  resumeTimeRef: MutableRefObject<number | null>;
  resumeModeRef: MutableRefObject<ResumeMode>;
  allowAutoResumeRef: MutableRefObject<boolean>;
  stableCurrentTimeRef: MutableRefObject<number>;
  clearTargetEpisodeProgressRef: MutableRefObject<boolean>;
  playbackRequestModeRef: MutableRefObject<PlaybackRequestMode>;
  lastVolumeRef: MutableRefObject<number>;
  lastPlaybackRateRef: MutableRefObject<number>;
  lastSkipCheckRef: MutableRefObject<number>;
  lastSaveTimeRef: MutableRefObject<number>;
  detailRef: MutableRefObject<SearchResult | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  wakeLockRef: MutableRefObject<WakeLockSentinel | null>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setRealtimeLoadSpeed: Dispatch<SetStateAction<string>>;
  setBlockAdEnabled: Dispatch<SetStateAction<boolean>>;
  handleNextEpisode: () => void;
  handleSkipConfigChange: (newConfig: SkipConfig) => Promise<void>;
  saveCurrentPlayProgress: () => void;
  requestWakeLock: () => Promise<void>;
  releaseWakeLock: () => Promise<void>;
  cleanupPlayer: () => void;
  onPlaybackStarted?: () => void;
  onSourceProxyFallbackStarted?: () => void;
  onCurrentSourceVideoInfo?: (
    info: CurrentSourceVideoInfo,
    context: CurrentSourceVideoInfoContext,
  ) => void;
}
