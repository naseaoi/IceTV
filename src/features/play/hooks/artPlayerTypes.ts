import type Artplayer from 'artplayer';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';
import type { WakeLockSentinel } from '@/features/play/lib/playTypes';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import type { VodPlaybackIntent } from '@/features/play/lib/vodPlaybackIntent';
import type { PlaybackStatsEvent } from '@/features/playback-stats/hooks/usePlaybackStatsReporter';
import type { SearchResult, SkipConfig } from '@/lib/types';

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
  isVideoLoading: boolean;
  playbackRetryNonce: number;
  detail: SearchResult | null;
  currentEpisodeIndex: number;
  totalEpisodes: number;
  blockAdEnabled: boolean;
  blockAdEnabledRef: MutableRefObject<boolean>;
  autoPlayNextEnabled: boolean;
  autoPlayNextEnabledRef: MutableRefObject<boolean>;
  setAutoPlayNextEnabled: Dispatch<SetStateAction<boolean>>;
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
  reportPlaybackStats?: (force?: boolean) => void;
  startPlaybackStatsSession?: () => void;
  handlePlaybackStatsEvent?: (event: PlaybackStatsEvent) => void;
  requestWakeLock: () => Promise<void>;
  releaseWakeLock: () => Promise<void>;
  cleanupPlayer: () => void;
  danmakuEnabledRef: MutableRefObject<boolean>;
  onDanmakuEnabledChange?: (enabled: boolean) => void;
  onPlaybackStarted?: () => void;
  onDanmakuEnable?: () => void;
  playbackIntentRef?: MutableRefObject<VodPlaybackIntent>;
  onSourceProxyFallbackStarted?: () => void;
  // 返回 true 表示已自动换源接手，播放器不再展示当前源失败
  onPlaybackRecoveryExhausted?: (reason: string) => boolean;
  onCurrentSourceVideoInfo?: (
    info: CurrentSourceVideoInfo,
    context: CurrentSourceVideoInfoContext,
  ) => void;
  // 最后一集真正播完（含跳片尾停在结尾）时调用，不自动连播的情形才会触发
  onLastEpisodeEnded?: () => void;
}
