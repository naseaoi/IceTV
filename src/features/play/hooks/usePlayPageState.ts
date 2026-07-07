'use client';

import type Artplayer from 'artplayer';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { PlayProgressSaveState } from '@/features/play/hooks/usePlayProgress';
import type { SourceSwitchEpisodeAnchor } from '@/features/play/lib/episodeResumePolicy';
import type { WakeLockSentinel } from '@/features/play/lib/playTypes';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import type { SourceSwitchCleanupTask } from '@/features/play/lib/sourceSwitchCleanup';
import {
  readBlockAdEnabled,
  readEnableOptimization,
} from '@/lib/local-preferences';
import { SearchResult } from '@/lib/types';

export interface SkipConfigState {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

export type LoadingStage = 'searching' | 'preferring' | 'fetching' | 'ready';
export type VideoLoadingStage =
  | 'initing'
  | 'sourceChanging'
  | 'episodeChanging';
export type PlaybackRequestMode = 'initial' | 'episode' | 'manual-source';
export type VideoQualityInfo = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
};
export type SourceRecommendation = {
  sourceName: string;
  quality: string;
  loadSpeed: string;
};

export function usePlayPageState(searchParams: ReadonlyURLSearchParams) {
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  const [favorited, setFavorited] = useState(false);

  const [skipConfig, setSkipConfig] = useState<SkipConfigState>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  const lastSkipCheckRef = useRef(0);

  const [blockAdEnabled, setBlockAdEnabled] =
    useState<boolean>(readBlockAdEnabled);
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || '',
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true',
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);

  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  const [videoUrl, setVideoUrl] = useState('');

  const resumeTimeRef = useRef<number | null>(null);
  const resumeModeRef = useRef<ResumeMode>(null);
  const allowAutoResumeRef = useRef(true);
  const stableCurrentTimeRef = useRef(0);
  const lastVolumeRef = useRef<number>(0.7);
  const lastPlaybackRateRef = useRef<number>(1.0);

  useEffect(() => {
    allowAutoResumeRef.current = true;
    stableCurrentTimeRef.current = 0;
  }, [currentSource, currentId, currentEpisodeIndex]);

  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null,
  );
  const sourceChangeRequestIdRef = useRef(0);
  const pendingSourceSwitchCleanupRef = useRef<SourceSwitchCleanupTask | null>(
    null,
  );
  const sourceSwitchEpisodeAnchorRef = useRef<SourceSwitchEpisodeAnchor | null>(
    null,
  );
  const playbackRequestModeRef = useRef<PlaybackRequestMode>('initial');

  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    return readEnableOptimization();
  });

  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, VideoQualityInfo>
  >(new Map());
  const [sourceRecommendation, setSourceRecommendation] =
    useState<SourceRecommendation | null>(null);
  const clearTargetEpisodeProgressRef = useRef(false);

  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoLoadingStage, setVideoLoadingStage] =
    useState<VideoLoadingStage>('initing');
  const [videoLoadingAttempt, setVideoLoadingAttempt] = useState(0);
  const [playbackRetryNonce, setPlaybackRetryNonce] = useState(0);
  const [realtimeLoadSpeed, setRealtimeLoadSpeed] =
    useState<string>('测速中...');

  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const playProgressSaveStateRef = useRef<PlayProgressSaveState>({
    inFlight: false,
    pending: null,
    lastSavedFingerprint: null,
  });

  const artPlayerRef = useRef<Artplayer | null>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  return {
    loading,
    setLoading,
    loadingStage,
    setLoadingStage,
    loadingMessage,
    setLoadingMessage,
    error,
    setError,
    detail,
    setDetail,
    favorited,
    setFavorited,
    skipConfig,
    setSkipConfig,
    skipConfigRef,
    lastSkipCheckRef,
    blockAdEnabled,
    setBlockAdEnabled,
    blockAdEnabledRef,
    videoTitle,
    setVideoTitle,
    videoYear,
    setVideoYear,
    videoCover,
    setVideoCover,
    videoDoubanId,
    setVideoDoubanId,
    currentSource,
    setCurrentSource,
    currentId,
    setCurrentId,
    searchTitle,
    searchType,
    needPrefer,
    setNeedPrefer,
    needPreferRef,
    currentEpisodeIndex,
    setCurrentEpisodeIndex,
    currentSourceRef,
    currentIdRef,
    videoTitleRef,
    videoYearRef,
    detailRef,
    currentEpisodeIndexRef,
    videoUrl,
    setVideoUrl,
    resumeTimeRef,
    resumeModeRef,
    allowAutoResumeRef,
    stableCurrentTimeRef,
    lastVolumeRef,
    lastPlaybackRateRef,
    availableSources,
    setAvailableSources,
    sourceSearchLoading,
    setSourceSearchLoading,
    sourceSearchError,
    setSourceSearchError,
    sourceChangeRequestIdRef,
    pendingSourceSwitchCleanupRef,
    sourceSwitchEpisodeAnchorRef,
    playbackRequestModeRef,
    optimizationEnabled,
    precomputedVideoInfo,
    setPrecomputedVideoInfo,
    sourceRecommendation,
    setSourceRecommendation,
    clearTargetEpisodeProgressRef,
    isEpisodeSelectorCollapsed,
    setIsEpisodeSelectorCollapsed,
    isVideoLoading,
    setIsVideoLoading,
    isPlaying,
    setIsPlaying,
    videoLoadingStage,
    setVideoLoadingStage,
    videoLoadingAttempt,
    setVideoLoadingAttempt,
    playbackRetryNonce,
    setPlaybackRetryNonce,
    realtimeLoadSpeed,
    setRealtimeLoadSpeed,
    saveIntervalRef,
    lastSaveTimeRef,
    playProgressSaveStateRef,
    artPlayerRef,
    artRef,
    wakeLockRef,
  };
}
