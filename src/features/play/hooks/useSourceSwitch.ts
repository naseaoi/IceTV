'use client';

import type Artplayer from 'artplayer';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from 'react';

import type {
  PlaybackRequestMode,
  SkipConfigState,
  VideoLoadingStage,
  VideoQualityInfo,
} from '@/features/play/hooks/usePlayPageState';
import {
  AUTO_SOURCE_SWITCH_MAX_ATTEMPTS,
  buildAutoSwitchSourceKey,
  rankAutoSwitchCandidates,
  selectAutoSwitchCandidates,
} from '@/features/play/lib/autoSourceSwitchPolicy';
import { carryOverDanmakuEpisodeMapping } from '@/features/play/lib/danmaku/episode-storage';
import { saveDetailSnapshot } from '@/features/play/lib/detailSnapshot';
import { resolveEpisodeTargetIndex } from '@/features/play/lib/episodeMapping';
import {
  type SourceSwitchEpisodeAnchor,
  resolveSourceSwitchCurrentPlayTime,
  resolveSourceSwitchEpisodeAnchor,
  resolveSourceSwitchResumeState,
} from '@/features/play/lib/episodeResumePolicy';
import { replacePlayPageUrl } from '@/features/play/lib/playPageUrl';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import { peekSourceSelectionContext } from '@/features/play/lib/sourceSelectionContext';
import {
  type SourceSwitchCleanupTask,
  finalizeSourceSwitchCleanup,
  shouldFinalizeSourceSwitchCleanup,
} from '@/features/play/lib/sourceSwitchCleanup';
import { getVodRuntimeSourceUrl } from '@/features/play/lib/vodHlsRuntime';
import {
  deletePlayRecord,
  deleteSkipConfig,
  saveSkipConfig,
} from '@/lib/db.client';
import { readAutoSwitchSource } from '@/lib/local-preferences';
import { savePlayIntent } from '@/lib/play-intent';
import { getManagedVideo, runManagedVideoCleanup } from '@/lib/player-runtime';
import { mergeSourceBundle } from '@/lib/source-bundle';
import {
  readSourcePlaybackStats,
  recordSourceManualSelection,
} from '@/lib/source-playback-stats';
import { SearchResult, SkipConfig } from '@/lib/types';

const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function hasDisplayText(value?: string): boolean {
  const text = value?.trim();
  return !!text && text !== 'unknown';
}

function mergeSourceSwitchDetail(
  preferred: SearchResult,
  fallback?: SearchResult,
  previous?: SearchResult | null,
): SearchResult {
  return {
    ...fallback,
    ...preferred,
    title: hasDisplayText(preferred.title)
      ? preferred.title
      : hasDisplayText(fallback?.title)
        ? fallback!.title
        : previous?.title || '',
    poster: preferred.poster || fallback?.poster || previous?.poster || '',
    episodes:
      preferred.episodes && preferred.episodes.length > 0
        ? preferred.episodes
        : fallback?.episodes || [],
    episodes_titles:
      preferred.episodes_titles && preferred.episodes_titles.length > 0
        ? preferred.episodes_titles
        : fallback?.episodes_titles || [],
    source_name: preferred.source_name || fallback?.source_name || '',
    year: hasDisplayText(preferred.year)
      ? preferred.year
      : hasDisplayText(fallback?.year)
        ? fallback!.year
        : previous?.year || preferred.year || fallback?.year || '',
    class: preferred.class || fallback?.class || previous?.class,
    desc: preferred.desc || fallback?.desc || previous?.desc,
    type_name:
      preferred.type_name || fallback?.type_name || previous?.type_name,
    douban_id:
      preferred.douban_id || fallback?.douban_id || previous?.douban_id,
    related_sources:
      preferred.related_sources ||
      fallback?.related_sources ||
      previous?.related_sources,
  };
}

interface UseSourceSwitchOptions {
  availableSources: SearchResult[];
  precomputedVideoInfo: ReadonlyMap<string, VideoQualityInfo>;
  currentEpisodeIndex: number;

  artPlayerRef: RefObject<Artplayer | null>;
  currentSourceRef: RefObject<string>;
  currentIdRef: RefObject<string>;
  detailRef: RefObject<SearchResult | null>;
  currentEpisodeIndexRef: RefObject<number>;
  skipConfigRef: RefObject<SkipConfigState>;
  resumeTimeRef: RefObject<number | null>;
  resumeModeRef: RefObject<ResumeMode>;
  stableCurrentTimeRef: RefObject<number>;
  clearTargetEpisodeProgressRef: RefObject<boolean>;
  sourceSwitchEpisodeAnchorRef: RefObject<SourceSwitchEpisodeAnchor | null>;
  playbackRequestModeRef: RefObject<PlaybackRequestMode>;
  pendingSourceSwitchCleanupRef: RefObject<SourceSwitchCleanupTask | null>;
  sourceChangeRequestIdRef: RefObject<number>;
  videoUrlRef: RefObject<string>;

  setError: Dispatch<SetStateAction<string | null>>;
  setVideoUrl: Dispatch<SetStateAction<string>>;
  setVideoTitle: Dispatch<SetStateAction<string>>;
  setVideoYear: Dispatch<SetStateAction<string>>;
  setVideoCover: Dispatch<SetStateAction<string>>;
  setVideoDoubanId: Dispatch<SetStateAction<number>>;
  setCurrentSource: Dispatch<SetStateAction<string>>;
  setCurrentId: Dispatch<SetStateAction<string>>;
  setDetail: Dispatch<SetStateAction<SearchResult | null>>;
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
  setAvailableSources: Dispatch<SetStateAction<SearchResult[]>>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setVideoLoadingStage: Dispatch<SetStateAction<VideoLoadingStage>>;
  setVideoLoadingAttempt: Dispatch<SetStateAction<number>>;
  setPlaybackRetryNonce: Dispatch<SetStateAction<number>>;
  setRealtimeLoadSpeed: Dispatch<SetStateAction<string>>;
  setSourceSearchError: Dispatch<SetStateAction<string | null>>;

  cleanupPlayer: () => void;
  // 自动换源的三个触发点都会调用，调用方负责只在本次加载尚未起播时计入失败
  onPlaybackStartFailed?: () => void;
}

export function useSourceSwitch(options: UseSourceSwitchOptions) {
  const {
    availableSources,
    precomputedVideoInfo,
    currentEpisodeIndex,
    artPlayerRef,
    currentSourceRef,
    currentIdRef,
    detailRef,
    currentEpisodeIndexRef,
    skipConfigRef,
    resumeTimeRef,
    resumeModeRef,
    stableCurrentTimeRef,
    clearTargetEpisodeProgressRef,
    sourceSwitchEpisodeAnchorRef,
    playbackRequestModeRef,
    pendingSourceSwitchCleanupRef,
    sourceChangeRequestIdRef,
    videoUrlRef,
    setError,
    setVideoUrl,
    setVideoTitle,
    setVideoYear,
    setVideoCover,
    setVideoDoubanId,
    setCurrentSource,
    setCurrentId,
    setDetail,
    setCurrentEpisodeIndex,
    setAvailableSources,
    setIsVideoLoading,
    setVideoLoadingStage,
    setVideoLoadingAttempt,
    setPlaybackRetryNonce,
    setRealtimeLoadSpeed,
    setSourceSearchError,
    cleanupPlayer,
    onPlaybackStartFailed,
  } = options;

  const autoSwitchFailedKeysRef = useRef<Set<string>>(new Set());
  const autoSwitchAttemptsRef = useRef(0);
  const tryAutoSwitchSourceRef = useRef<(reason: string) => boolean>(
    () => false,
  );
  // 从换源开始到提交新源为 true：旧源已停，期间的超时和失败回调属于被放弃的源，不能再触发换源或改动页面状态
  const sourceSwitchInFlightRef = useRef(false);
  // 进行中换源的详情请求；被新的换源取代或等待超过页面超时都要中止，否则加载层会一直停在切换中
  const sourceDetailAbortRef = useRef<AbortController | null>(null);
  // 拒绝换源后当前源要重新加载，重载会清掉播放器提示，留到重新起播后再显示
  const pendingPlaybackNoticeRef = useRef<string | null>(null);

  const resetAutoSourceSwitch = useCallback(() => {
    autoSwitchFailedKeysRef.current = new Set();
    autoSwitchAttemptsRef.current = 0;
    pendingPlaybackNoticeRef.current = null;
  }, []);

  const stopActiveHlsLoading = useCallback(() => {
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    if (!video) return;

    const managedVideo = getManagedVideo(video);
    try {
      // 连同本次加载的运行时一起释放，否则待执行的恢复重试或代理探测会在停止后重新拉流
      runManagedVideoCleanup(video);
      managedVideo.hls?.stopLoad?.();
      // 已缓冲的旧内容继续播放会照常触发 timeupdate/ended，驱动自动下一集和续播窗口判断
      video.pause();
    } catch (err) {
      console.warn('停止失败源加载失败:', err);
    }
    setRealtimeLoadSpeed('');
  }, [artPlayerRef, setRealtimeLoadSpeed]);

  // 按当前进度重新拉起同一地址；重试和拒绝换源共用
  const restartCurrentPlayback = useCallback(() => {
    // 清进度标记未解除说明目标集还没起播，播放器上的时间属于上一集，只能沿用原恢复点
    const resumeTime = clearTargetEpisodeProgressRef.current
      ? (resumeTimeRef.current ?? 0)
      : resolveSourceSwitchCurrentPlayTime({
          playerCurrentTime: artPlayerRef.current?.currentTime || 0,
          pendingResumeTime: resumeTimeRef.current,
          stableCurrentTime: stableCurrentTimeRef.current,
        });
    if (resumeTime > 1) {
      resumeTimeRef.current = resumeTime;
      resumeModeRef.current = 'forced';
    }
    setError(null);
    setIsVideoLoading(true);
    setVideoLoadingAttempt((prev) => prev + 1);
    setPlaybackRetryNonce((prev) => prev + 1);
  }, [
    artPlayerRef,
    resumeTimeRef,
    resumeModeRef,
    stableCurrentTimeRef,
    clearTargetEpisodeProgressRef,
    setError,
    setIsVideoLoading,
    setVideoLoadingAttempt,
    setPlaybackRetryNonce,
  ]);

  const showPendingPlaybackNotice = useCallback(() => {
    const notice = pendingPlaybackNoticeRef.current;
    pendingPlaybackNoticeRef.current = null;
    const player = artPlayerRef.current;
    if (!notice || !player) return;
    try {
      player.notice.show = notice;
    } catch (err) {
      console.warn('显示换源拒绝提示失败:', err);
    }
  }, [artPlayerRef]);

  const handleSourceChange = useCallback(
    async (
      newSource: string,
      newId: string,
      newTitle: string,
      switchOptions?: { auto?: boolean },
    ) => {
      if (
        newSource === currentSourceRef.current &&
        newId === currentIdRef.current
      ) {
        return;
      }

      const targetSource = availableSources.find(
        (source) => source.source === newSource && source.id === newId,
      );
      if (!targetSource) {
        setError('未找到匹配结果');
        return;
      }
      const isAutoSwitch = switchOptions?.auto === true;
      if (!isAutoSwitch) {
        resetAutoSourceSwitch();
      }
      playbackRequestModeRef.current = isAutoSwitch
        ? 'auto-source'
        : 'manual-source';

      const currentRequestId = ++sourceChangeRequestIdRef.current;
      sourceSwitchInFlightRef.current = true;
      sourceDetailAbortRef.current?.abort();
      const detailAbortController = new AbortController();
      sourceDetailAbortRef.current = detailAbortController;
      pendingPlaybackNoticeRef.current = null;
      // 懒解析按请求号作废；旧源运行时不停掉的话，等新源详情期间它的失败会再次触发换源并覆盖本次选择
      stopActiveHlsLoading();
      const previousSource = currentSourceRef.current;
      const previousId = currentIdRef.current;
      const previousDetail = detailRef.current;
      const previousSkipConfig: SkipConfig = { ...skipConfigRef.current };
      const currentPlayTime = resolveSourceSwitchCurrentPlayTime({
        playerCurrentTime: artPlayerRef.current?.currentTime || 0,
        pendingResumeTime: resumeTimeRef.current,
        stableCurrentTime: stableCurrentTimeRef.current,
      });

      pendingSourceSwitchCleanupRef.current = null;

      try {
        setVideoLoadingStage('sourceChanging');
        setIsVideoLoading(true);
        setVideoLoadingAttempt((prev) => prev + 1);
        setRealtimeLoadSpeed(
          isAutoSwitch ? '正在尝试其他源...' : '正在切换源站...',
        );
        setError(null);

        if (artPlayerRef.current) {
          try {
            artPlayerRef.current.pause();
            // Artplayer 的 pause() 会弹出「暂停」提示，程序性暂停不是用户操作
            artPlayerRef.current.notice.show = '';
          } catch (err) {
            console.warn('换源时暂停当前视频失败:', err);
          }
        }

        let newDetail = mergeSourceSwitchDetail(
          targetSource,
          targetSource,
          previousDetail,
        );

        try {
          const detailRes = await fetch(
            `/api/detail?source=${newSource}&id=${newId}`,
            IS_DEVELOPMENT
              ? { cache: 'no-store', signal: detailAbortController.signal }
              : { signal: detailAbortController.signal },
          );
          if (currentRequestId !== sourceChangeRequestIdRef.current) {
            return;
          }
          if (detailRes.ok) {
            const fullDetail = (await detailRes.json()) as SearchResult;
            if (fullDetail.episodes && fullDetail.episodes.length > 0) {
              saveDetailSnapshot(newSource, newId, fullDetail);
              newDetail = mergeSourceSwitchDetail(
                fullDetail,
                targetSource,
                previousDetail,
              );
              setAvailableSources((prev) => mergeSourceBundle(prev, newDetail));
            }
          }
        } catch (err) {
          // 被新的换源取代而中止是预期内的，由下面的请求号判断直接收尾
          if (currentRequestId === sourceChangeRequestIdRef.current) {
            console.error('换源刷新详情失败:', err);
          }
        }

        if (currentRequestId !== sourceChangeRequestIdRef.current) {
          return;
        }

        const latestEpisodeIndex = Math.max(
          currentEpisodeIndex,
          currentEpisodeIndexRef.current,
        );
        const episodeAnchor = resolveSourceSwitchEpisodeAnchor({
          currentAnchor: sourceSwitchEpisodeAnchorRef.current,
          activeDetail: previousDetail,
          activeEpisodeIndex: latestEpisodeIndex,
        });
        const resolvedEpisodeTarget = resolveEpisodeTargetIndex(
          episodeAnchor.detail,
          episodeAnchor.episodeIndex,
          newDetail,
        );
        let targetIndex = resolvedEpisodeTarget.index;
        let preserveProgress = resolvedEpisodeTarget.preserveProgress;
        const clearTargetEpisodeProgress =
          clearTargetEpisodeProgressRef.current;

        if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
          targetIndex = 0;
          preserveProgress = false;
        }

        if (
          !preserveProgress &&
          (isAutoSwitch ||
            (!clearTargetEpisodeProgress && episodeAnchor.episodeIndex > 0))
        ) {
          // 候选按搜索结果预筛过，拉到完整详情后仍缺目标集时换下一个，不能自动跳到别的集
          if (isAutoSwitch) {
            autoSwitchFailedKeysRef.current.add(
              buildAutoSwitchSourceKey(newSource, newId),
            );
            // 本次换源到此结束，放开进行中标记才能接着尝试下一个候选
            sourceSwitchInFlightRef.current = false;
            if (!tryAutoSwitchSourceRef.current('missing-episode')) {
              setIsVideoLoading(false);
              setRealtimeLoadSpeed('');
              playbackRequestModeRef.current = 'initial';
              setError('当前源加载失败');
            }
            return;
          }

          const targetEpisodeNumber = episodeAnchor.episodeIndex + 1;
          const notice = `该源没有第 ${targetEpisodeNumber} 集，已保留当前播放`;
          if (artPlayerRef.current) {
            pendingPlaybackNoticeRef.current = notice;
          } else {
            setSourceSearchError(notice);
          }
          setVideoLoadingStage('initing');
          setRealtimeLoadSpeed('');
          playbackRequestModeRef.current = 'initial';
          // 换源开始时已停掉当前源，拒绝后按原进度重新拉起
          restartCurrentPlayback();
          return;
        }

        // 同一站点内切换版本不算对该源的偏好
        if (!isAutoSwitch && newSource !== previousSource) {
          recordSourceManualSelection(newSource);
        }
        sourceSwitchEpisodeAnchorRef.current = episodeAnchor;
        if (preserveProgress) {
          carryOverDanmakuEpisodeMapping(
            [
              {
                source: previousSource,
                videoId: previousId,
                episodeIndex: latestEpisodeIndex,
              },
              ...(episodeAnchor.detail
                ? [
                    {
                      source: episodeAnchor.detail.source,
                      videoId: episodeAnchor.detail.id,
                      episodeIndex: episodeAnchor.episodeIndex,
                    },
                  ]
                : []),
            ],
            {
              source: newDetail.source,
              videoId: newDetail.id,
              episodeIndex: targetIndex,
            },
          );
        }
        setVideoUrl('');
        cleanupPlayer();

        const nextResumeState = resolveSourceSwitchResumeState({
          currentPlayTime,
          preserveProgress,
          clearTargetEpisodeProgress,
        });

        savePlayIntent({
          source: newDetail.source,
          id: newDetail.id,
          episodeIndex: targetIndex,
          resumeTime: nextResumeState.resumeTime,
        });

        resumeTimeRef.current = nextResumeState.resumeTime;
        resumeModeRef.current = nextResumeState.resumeMode;

        const nextYear = hasDisplayText(newDetail.year)
          ? newDetail.year
          : previousDetail?.year || '';
        const nextTitle =
          newDetail.title || newTitle || previousDetail?.title || '';
        setVideoTitle(nextTitle);
        setVideoYear(nextYear);
        setVideoCover(newDetail.poster);
        setVideoDoubanId(newDetail.douban_id || 0);
        setCurrentSource(newDetail.source);
        setCurrentId(newDetail.id);
        setDetail(newDetail);
        currentEpisodeIndexRef.current = targetIndex;
        setCurrentEpisodeIndex(targetIndex);
        // 刷新和分享要落到新源；init 只在挂载时读一次地址参数，替换地址不会重新搜索起播
        replacePlayPageUrl(
          { source: newDetail.source, id: newDetail.id, title: nextTitle },
          nextYear,
        );
        setRealtimeLoadSpeed('正在加载新源...');
        // 换源等待期间页面超时被压下，新源从这里重新计时
        setVideoLoadingAttempt((prev) => prev + 1);

        if (
          previousSource &&
          previousId &&
          (previousSource !== newDetail.source || previousId !== newDetail.id)
        ) {
          pendingSourceSwitchCleanupRef.current = {
            previousSource,
            previousId,
            nextSource: newDetail.source,
            nextId: newDetail.id,
            previousSkipConfig,
            keepPreviousPlayRecord: clearTargetEpisodeProgress,
          };
        }
      } catch (err) {
        if (currentRequestId !== sourceChangeRequestIdRef.current) {
          return;
        }
        pendingSourceSwitchCleanupRef.current = null;
        setIsVideoLoading(false);
        setRealtimeLoadSpeed('');
        playbackRequestModeRef.current = 'initial';
        setError(err instanceof Error ? err.message : '换源失败');
      } finally {
        if (currentRequestId === sourceChangeRequestIdRef.current) {
          sourceSwitchInFlightRef.current = false;
        }
      }
    },
    [
      availableSources,
      currentEpisodeIndex,
      artPlayerRef,
      currentSourceRef,
      currentIdRef,
      detailRef,
      currentEpisodeIndexRef,
      skipConfigRef,
      resumeTimeRef,
      resumeModeRef,
      stableCurrentTimeRef,
      clearTargetEpisodeProgressRef,
      sourceSwitchEpisodeAnchorRef,
      playbackRequestModeRef,
      pendingSourceSwitchCleanupRef,
      sourceChangeRequestIdRef,
      setError,
      setVideoUrl,
      setVideoTitle,
      setVideoYear,
      setVideoCover,
      setVideoDoubanId,
      setCurrentSource,
      setCurrentId,
      setDetail,
      setCurrentEpisodeIndex,
      setAvailableSources,
      setIsVideoLoading,
      setVideoLoadingStage,
      setVideoLoadingAttempt,
      setRealtimeLoadSpeed,
      setSourceSearchError,
      cleanupPlayer,
      resetAutoSourceSwitch,
      stopActiveHlsLoading,
      restartCurrentPlayback,
    ],
  );

  const tryAutoSwitchSource = useCallback(
    (reason: string): boolean => {
      if (sourceSwitchInFlightRef.current) return true;
      if (!readAutoSwitchSource()) return false;
      const curSource = currentSourceRef.current;
      const curId = currentIdRef.current;
      if (!curSource || !curId) return false;

      const failedKeys = autoSwitchFailedKeysRef.current;
      failedKeys.add(buildAutoSwitchSourceKey(curSource, curId));
      if (autoSwitchAttemptsRef.current >= AUTO_SOURCE_SWITCH_MAX_ATTEMPTS) {
        return false;
      }

      const episodeAnchor = resolveSourceSwitchEpisodeAnchor({
        currentAnchor: sourceSwitchEpisodeAnchorRef.current,
        activeDetail: detailRef.current,
        activeEpisodeIndex: Math.max(
          currentEpisodeIndex,
          currentEpisodeIndexRef.current,
        ),
      });
      const [target] = rankAutoSwitchCandidates(
        selectAutoSwitchCandidates({
          availableSources,
          excludedKeys: failedKeys,
          referenceDetail: episodeAnchor.detail,
          referenceEpisodeIndex: episodeAnchor.episodeIndex,
        }),
        precomputedVideoInfo,
        readSourcePlaybackStats(),
        Date.now(),
        peekSourceSelectionContext(),
      );
      if (!target) return false;

      const targetKey = buildAutoSwitchSourceKey(target.source, target.id);
      // 发起即记为已尝试，换源完成前即使再次触发也不会重复选中同一目标
      failedKeys.add(targetKey);
      autoSwitchAttemptsRef.current += 1;
      console.warn('当前源播放失败，自动切换其他源', {
        from: buildAutoSwitchSourceKey(curSource, curId),
        to: targetKey,
        reason,
      });
      void handleSourceChange(target.source, target.id, target.title, {
        auto: true,
      });
      return true;
    },
    [
      availableSources,
      precomputedVideoInfo,
      currentEpisodeIndex,
      currentSourceRef,
      currentIdRef,
      detailRef,
      currentEpisodeIndexRef,
      sourceSwitchEpisodeAnchorRef,
      handleSourceChange,
    ],
  );

  useEffect(() => {
    tryAutoSwitchSourceRef.current = tryAutoSwitchSource;
  }, [tryAutoSwitchSource]);

  // 以下入口会被播放器实例和长生命周期 effect 捕获，经 ref 调用保持引用稳定
  const handleLoadingTimeout = useCallback((): boolean => {
    // 换源等待详情期间的页面超时即详情请求超时：中止请求，按详情获取失败继续换源，提交新源时重新计时
    if (sourceSwitchInFlightRef.current) {
      sourceDetailAbortRef.current?.abort();
      return true;
    }
    if (!currentSourceRef.current || !currentIdRef.current) return false;

    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const activeVideoUrl = videoUrlRef.current;
    // 懒解析换集会先清空 videoUrl，此时播放器上挂的仍是上一集的运行时，回退代理会重载上一集并把它的进度带进新集
    if (
      video &&
      activeVideoUrl &&
      getVodRuntimeSourceUrl(video) === activeVideoUrl &&
      getManagedVideo(video).__icetvSwitchToServerProxy?.(
        'page-loading-timeout',
      )
    ) {
      return true;
    }
    onPlaybackStartFailed?.();
    if (tryAutoSwitchSourceRef.current('loading-timeout')) {
      return true;
    }

    stopActiveHlsLoading();
    setRealtimeLoadSpeed('当前源加载超时');
    return false;
  }, [
    artPlayerRef,
    currentSourceRef,
    currentIdRef,
    videoUrlRef,
    stopActiveHlsLoading,
    setRealtimeLoadSpeed,
    onPlaybackStartFailed,
  ]);

  const handlePlaybackRecoveryExhausted = useCallback(
    (reason: string) => {
      if (sourceSwitchInFlightRef.current) return true;
      onPlaybackStartFailed?.();
      return tryAutoSwitchSourceRef.current(reason);
    },
    [onPlaybackStartFailed],
  );

  const handleEpisodeUrlResolveFailed = useCallback(() => {
    if (sourceSwitchInFlightRef.current) return;
    onPlaybackStartFailed?.();
    if (tryAutoSwitchSourceRef.current('episode-url-resolve-failed')) {
      return;
    }
    stopActiveHlsLoading();
    setRealtimeLoadSpeed('播放地址解析失败');
  }, [stopActiveHlsLoading, setRealtimeLoadSpeed, onPlaybackStartFailed]);

  const finalizePendingSourceSwitchCleanup = useCallback(
    async (activeSource: string, activeId: string) => {
      const task = pendingSourceSwitchCleanupRef.current;
      if (!shouldFinalizeSourceSwitchCleanup(task, activeSource, activeId)) {
        return;
      }

      pendingSourceSwitchCleanupRef.current = null;

      await finalizeSourceSwitchCleanup(task, {
        deletePlayRecord,
        deleteSkipConfig,
        saveSkipConfig,
      });
    },
    [pendingSourceSwitchCleanupRef],
  );

  return {
    handleSourceChange,
    handleLoadingTimeout,
    handlePlaybackRecoveryExhausted,
    handleEpisodeUrlResolveFailed,
    resetAutoSourceSwitch,
    finalizePendingSourceSwitchCleanup,
    stopActiveHlsLoading,
    restartCurrentPlayback,
    showPendingPlaybackNotice,
  };
}
