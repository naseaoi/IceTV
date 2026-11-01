import { useEffect, useRef } from 'react';

import type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';
import { initializeArtPlayer } from '@/features/play/hooks/useArtPlayer.init';
import { reloadDanmaku } from '@/features/play/lib/danmaku/attach';
import { setDanmakuLoadNoticeVisibility } from '@/features/play/lib/danmaku/load-notice';
import { PlayerLoadingSessionState } from '@/features/play/lib/playerLoading';
import { getVodRuntimeSourceUrl } from '@/features/play/lib/vodHlsRuntime';
import type { SourcePlaybackRoute } from '@/lib/proxy-modes';

export type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';

export function useArtPlayer(params: UseArtPlayerParams) {
  const {
    artRef,
    videoUrl,
    loading,
    playbackRetryNonce,
    detail,
    currentEpisodeIndex,
    blockAdEnabled,
  } = params;
  const source = detail?.source;
  const id = detail?.id;
  const validEpisode = !!detail?.episodes?.[currentEpisodeIndex];

  const loadingSessionRef = useRef<PlayerLoadingSessionState>({
    pendingInitialResumeTarget: null,
    playbackStartNotified: false,
  });
  const autoAdvanceArmedRef = useRef(false);
  const autoAdvancedRef = useRef(false);
  const playerMediaKindRef = useRef<'hls' | 'native' | null>(null);
  const sessionEpisodeIndexRef = useRef<number | null>(null);
  const playbackRouteRef = useRef<SourcePlaybackRoute | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    const latest = paramsRef.current;
    const player = latest.artPlayerRef.current;
    setDanmakuLoadNoticeVisibility(player, !latest.isVideoLoading);
    if (!player) return;
    player.title = `${latest.detail?.title || latest.videoTitle} - 第${latest.currentEpisodeIndex + 1}集`;
    // 分组刷新可能只移动绝对索引：更新会话与弹幕身份，保留相同地址的在途加载。
    if (
      sessionEpisodeIndexRef.current !== null &&
      sessionEpisodeIndexRef.current !== latest.currentEpisodeIndex &&
      getVodRuntimeSourceUrl(player.video) === latest.videoUrl
    ) {
      sessionEpisodeIndexRef.current = latest.currentEpisodeIndex;
      void reloadDanmaku(
        player,
        {
          source: latest.detail?.source || '',
          videoId: latest.detail?.id || '',
          episodeIndex: latest.currentEpisodeIndex,
          searchTitle: latest.detail?.title || latest.videoTitle,
          searchYear: latest.detail?.year || '',
        },
        latest.danmakuEnabledRef,
      );
    }
  });

  useEffect(() => {
    if (!videoUrl || loading || !artRef.current) return;
    const latest = paramsRef.current;
    if (!validEpisode) {
      latest.setError(`选集索引无效，当前共 ${latest.totalEpisodes} 集`);
      return;
    }

    let cancelled = false;
    autoAdvanceArmedRef.current = false;
    autoAdvancedRef.current = false;

    // 复用实例上的事件监听保留这些转发函数，详情刷新后仍消费最新回调。
    void initializeArtPlayer(
      {
        ...latest,
        handleNextEpisode: () => paramsRef.current.handleNextEpisode(),
        handleSkipConfigChange: (config) =>
          paramsRef.current.handleSkipConfigChange(config),
        saveCurrentPlayProgress: () =>
          paramsRef.current.saveCurrentPlayProgress(),
        reportPlaybackStats: (force) =>
          paramsRef.current.reportPlaybackStats?.(force),
        startPlaybackStatsSession: () =>
          paramsRef.current.startPlaybackStatsSession?.(),
        onPlaybackStarted: () => paramsRef.current.onPlaybackStarted?.(),
        onSourceProxyFallbackStarted: () =>
          paramsRef.current.onSourceProxyFallbackStarted?.(),
        onPlaybackRecoveryExhausted: (reason) =>
          paramsRef.current.onPlaybackRecoveryExhausted?.(reason) ?? false,
        onCurrentSourceVideoInfo: (info, context) =>
          paramsRef.current.onCurrentSourceVideoInfo?.(info, context),
        onDanmakuEnable: () => paramsRef.current.onDanmakuEnable?.(),
        onDanmakuEnabledChange: (enabled) =>
          paramsRef.current.onDanmakuEnabledChange?.(enabled),
      },
      {
        loadingSessionRef,
        autoAdvanceArmedRef,
        autoAdvancedRef,
        playerMediaKindRef,
        sessionEpisodeIndexRef,
        playbackRouteRef,
        isCancelled: () =>
          cancelled ||
          paramsRef.current.loading ||
          paramsRef.current.videoUrl !== videoUrl ||
          paramsRef.current.detail?.source !== source ||
          paramsRef.current.detail?.id !== id ||
          paramsRef.current.playbackRetryNonce !== playbackRetryNonce ||
          paramsRef.current.blockAdEnabled !== blockAdEnabled,
      },
    );

    return () => {
      cancelled = true;
    };
  }, [
    videoUrl,
    artRef,
    blockAdEnabled,
    source,
    id,
    validEpisode,
    loading,
    playbackRetryNonce,
  ]);
}
