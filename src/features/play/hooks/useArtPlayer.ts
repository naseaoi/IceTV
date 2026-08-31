import { useEffect, useRef } from 'react';

import type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';
import { initializeArtPlayer } from '@/features/play/hooks/useArtPlayer.init';
import { PlayerLoadingSessionState } from '@/features/play/lib/playerLoading';

export type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';

export function useArtPlayer(params: UseArtPlayerParams) {
  const {
    artRef,
    videoUrl,
    loading,
    playbackRetryNonce,
    detail,
    currentEpisodeIndex,
    totalEpisodes,
    blockAdEnabled,
    playbackRequestModeRef,
    setError,
    onPlaybackStarted,
    onSourceProxyFallbackStarted,
  } = params;

  const loadingSessionRef = useRef<PlayerLoadingSessionState>({
    pendingInitialResumeTarget: null,
    playbackStartNotified: false,
  });
  const autoAdvanceArmedRef = useRef(false);
  const autoAdvancedRef = useRef(false);
  const playerMediaKindRef = useRef<'hls' | 'native' | null>(null);
  const sessionEpisodeIndexRef = useRef<number | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    let cancelled = false;
    autoAdvanceArmedRef.current = false;
    autoAdvancedRef.current = false;

    void initializeArtPlayer(paramsRef.current, {
      loadingSessionRef,
      autoAdvanceArmedRef,
      autoAdvancedRef,
      playerMediaKindRef,
      sessionEpisodeIndexRef,
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
  }, [
    videoUrl,
    artRef,
    blockAdEnabled,
    currentEpisodeIndex,
    detail,
    loading,
    onPlaybackStarted,
    onSourceProxyFallbackStarted,
    playbackRequestModeRef,
    playbackRetryNonce,
    setError,
    totalEpisodes,
  ]);
}
