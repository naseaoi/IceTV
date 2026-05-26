'use client';

import type Artplayer from 'artplayer';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  deletePlayRecord,
  deleteSkipConfig,
  getSkipConfig,
  saveSkipConfig,
} from '@/lib/db.client';
import {
  destroyManagedHls,
  preloadPlayerModules,
  runManagedVideoCleanup,
} from '@/lib/player-runtime';
import { mergeSourceBundle } from '@/lib/source-bundle';
import { SearchResult, SkipConfig } from '@/lib/types';
import { preloadProxyModes } from '@/lib/proxy-modes';
import {
  clearSourceFailure,
  markSourceFailed,
} from '@/lib/failed-source-cooldown';
import {
  AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
  LOCAL_SETTING_CHANGED_EVENT,
  readBooleanLocalSetting,
} from '@/lib/local-settings';

import { PlayMainContent } from '@/features/play/components/PlayMainContent';
import { useArtPlayer } from '@/features/play/hooks/useArtPlayer';
import { usePlayFavorite } from '@/features/play/hooks/usePlayFavorite';
import { usePlayInit, updateVideoUrl } from '@/features/play/hooks/usePlayInit';
import { writePlayerInfo } from '@/features/play/lib/sourceProbeStore';
import {
  PlayErrorView,
  PlayLoadingView,
} from '@/features/play/components/PlayStateViews';
import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';
import { resolveEpisodeTargetIndex } from '@/features/play/lib/episodeMapping';
import {
  SourceSwitchEpisodeAnchor,
  resolveSourceSwitchEpisodeAnchor,
  resolveSourceSwitchCurrentPlayTime,
  resolveSourceSwitchResumeState,
} from '@/features/play/lib/episodeResumePolicy';
import { savePlayIntent } from '@/features/play/lib/playIntent';
import {
  PlayProgressSaveState,
  usePlayProgress,
} from '@/features/play/hooks/usePlayProgress';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import {
  finalizeSourceSwitchCleanup,
  shouldFinalizeSourceSwitchCleanup,
  SourceSwitchCleanupTask,
} from '@/features/play/lib/sourceSwitchCleanup';
import {
  AUTH_LOST_EVENT,
  SessionLostDetail,
  SessionLostReason,
  WakeLockSentinel,
} from '@/features/play/lib/playTypes';

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 预热源站流量路由缓存 + 播放器模块
  useEffect(() => {
    preloadProxyModes();
    preloadPlayerModules();
  }, []);

  // ---------------------------------------------------------------------------
  // 状态变量
  // ---------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({ enable: false, intro_time: 0, outro_time: 0 });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳过检查时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 视频基本信息
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

  // Refs
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

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');
  const totalEpisodes = detail?.episodes?.length || 0;

  // 播放恢复相关
  const resumeTimeRef = useRef<number | null>(null);
  const resumeModeRef = useRef<ResumeMode>(null);
  const allowAutoResumeRef = useRef(true);
  const stableCurrentTimeRef = useRef(0);
  const lastVolumeRef = useRef<number>(0.7);
  const lastPlaybackRateRef = useRef<number>(1.0);

  useEffect(() => {
    // 新的一集/新源开始加载时重新打开自动恢复窗口；
    // 超过前几秒后会由播放器侧主动关闭，避免后续 canplay 再次误套用旧进度。
    allowAutoResumeRef.current = true;
    stableCurrentTimeRef.current = 0;
  }, [currentSource, currentId, currentEpisodeIndex]);

  // 换源相关状态
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
  // 15s 加载超时后已尝试过的源（格式 `${source}-${id}`）；
  // 用户手动换源或成功起播后清空，避免永久屏蔽某个源。
  const failedSourcesRef = useRef<Set<string>>(new Set());
  // 自动降级正在进行中时为 true，用于区分是否为用户主动换源——
  // 主动换源要清空 failedSourcesRef，自动降级不能清，否则陷入死循环。
  const autoFallbackInProgressRef = useRef(false);

  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });
  const [autoSwitchSourceOnTimeout, setAutoSwitchSourceOnTimeout] =
    useState<boolean>(() =>
      readBooleanLocalSetting(AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY, false),
    );

  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());
  // 切集后到新一集真正起播前，禁止把上一集的时间继续带到目标集。
  const clearTargetEpisodeProgressRef = useRef(false);

  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');
  const [videoLoadingAttempt, setVideoLoadingAttempt] = useState(0);
  const [realtimeLoadSpeed, setRealtimeLoadSpeed] =
    useState<string>('测速中...');
  const [authRecoveryVisible, setAuthRecoveryVisible] = useState(false);
  const [authRecoveryReason, setAuthRecoveryReason] =
    useState<SessionLostReason>('missing_cookie');
  const [authRecoveryLoginUrl, setAuthRecoveryLoginUrl] = useState('');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const playProgressSaveStateRef = useRef<PlayProgressSaveState>({
    inFlight: false,
    pending: null,
    lastSavedFingerprint: null,
  });

  const artPlayerRef = useRef<Artplayer | null>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // Wake Lock 相关
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // ---------------------------------------------------------------------------
  // 工具函数
  // ---------------------------------------------------------------------------

  // 清理播放器资源
  const cleanupPlayer = useCallback(() => {
    const player = artPlayerRef.current;
    artPlayerRef.current = null;
    if (player) {
      try {
        if (player.video) {
          runManagedVideoCleanup(player.video);
          player.video.pause();
          player.video.removeAttribute('src');
          player.video.load();
          destroyManagedHls(player.video);
        }
        player.destroy();
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
      }
    }
  }, []);

  const finalizePendingSourceSwitchCleanup = useCallback(
    async (activeSource: string, activeId: string) => {
      const task = pendingSourceSwitchCleanupRef.current;
      if (!shouldFinalizeSourceSwitchCleanup(task, activeSource, activeId)) {
        return;
      }

      // 先清空 ref，避免 playing/canplay 连续触发时重复执行迁移。
      pendingSourceSwitchCleanupRef.current = null;

      await finalizeSourceSwitchCleanup(task, {
        deletePlayRecord,
        deleteSkipConfig,
        saveSkipConfig,
      });
    },
    [],
  );

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = useCallback(
    async (newConfig: {
      enable: boolean;
      intro_time: number;
      outro_time: number;
    }) => {
      if (!currentSourceRef.current || !currentIdRef.current) return;

      try {
        setSkipConfig(newConfig);
        if (
          !newConfig.enable &&
          !newConfig.intro_time &&
          !newConfig.outro_time
        ) {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current,
          );
          // Artplayer 的 setting.update 类型声明中 onSwitch 回调签名过于严格，
          // 但运行时只需读取 item.switch，使用类型断言以匹配 Setting 接口
          const updateSetting = artPlayerRef.current?.setting.update.bind(
            artPlayerRef.current.setting,
          );
          if (updateSetting) {
            updateSetting({
              name: '跳过片头片尾',
              html: '跳过片头片尾',
              switch: skipConfigRef.current.enable,
              onSwitch(item: { switch?: boolean }) {
                const cfg = { ...skipConfigRef.current, enable: !item.switch };
                handleSkipConfigChange(cfg);
                return !item.switch;
              },
            } as Parameters<typeof updateSetting>[0]);
            updateSetting({
              name: '设置片头',
              html: '设置片头',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0
                  ? '设置片头时间'
                  : `${formatTimeSimple(skipConfigRef.current.intro_time)}`,
              onClick: function () {
                const currentTime = artPlayerRef.current?.currentTime || 0;
                if (currentTime > 0) {
                  const cfg = {
                    ...skipConfigRef.current,
                    intro_time: currentTime,
                  };
                  handleSkipConfigChange(cfg);
                  return `${formatTimeSimple(currentTime)}`;
                }
              },
            } as Parameters<typeof updateSetting>[0]);
            updateSetting({
              name: '设置片尾',
              html: '设置片尾',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.outro_time >= 0
                  ? '设置片尾时间'
                  : `-${formatTimeSimple(-skipConfigRef.current.outro_time)}`,
              onClick: function () {
                const outroTime =
                  -(
                    (artPlayerRef.current?.duration ?? 0) -
                    (artPlayerRef.current?.currentTime ?? 0)
                  ) || 0;
                if (outroTime < 0) {
                  const cfg = {
                    ...skipConfigRef.current,
                    outro_time: outroTime,
                  };
                  handleSkipConfigChange(cfg);
                  return `-${formatTimeSimple(-outroTime)}`;
                }
              },
            } as Parameters<typeof updateSetting>[0]);
          }
        } else {
          await saveSkipConfig(
            currentSourceRef.current,
            currentIdRef.current,
            newConfig,
          );
        }
      } catch (err) {
        console.error('保存跳过片头片尾配置失败:', err);
      }
    },
    [],
  );

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex, videoUrl, setVideoUrl);
  }, [detail, currentEpisodeIndex]);

  useEffect(() => {
    if (!isVideoLoading && videoLoadingStage === 'sourceChanging') {
      setVideoLoadingStage('initing');
    }
  }, [isVideoLoading, videoLoadingStage]);

  // ---------------------------------------------------------------------------
  // 初始化 hook
  // ---------------------------------------------------------------------------

  usePlayInit({
    currentSource,
    currentId,
    videoTitle,
    searchTitle,
    searchType,
    needPreferRef,
    videoTitleRef,
    videoYearRef,
    currentEpisodeIndex,
    optimizationEnabled,
    setLoading,
    setLoadingStage,
    setLoadingMessage,
    setError,
    setDetail,
    setCurrentSource,
    setCurrentId,
    setVideoTitle,
    setVideoYear,
    setVideoCover,
    setVideoDoubanId,
    setCurrentEpisodeIndex,
    setNeedPrefer,
    setAvailableSources,
    setSourceSearchLoading,
    setSourceSearchError,
    setPrecomputedVideoInfo,
  });

  // 跳过片头片尾配置处理
  useEffect(() => {
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;
      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) setSkipConfig(config);
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };
    initSkipConfig();
  }, []);

  // ---------------------------------------------------------------------------
  // 播放进度 hook
  // ---------------------------------------------------------------------------

  const {
    saveCurrentPlayProgress: doSaveCurrentProgress,
    savePlaybackCheckpoint: doSaveCheckpoint,
    requestWakeLock,
    releaseWakeLock,
  } = usePlayProgress({
    artPlayerRef,
    currentSourceRef,
    currentIdRef,
    videoTitleRef,
    detailRef,
    currentEpisodeIndexRef,
    resumeTimeRef,
    resumeModeRef,
    allowAutoResumeRef,
    stableCurrentTimeRef,
    clearTargetEpisodeProgressRef,
    saveStateRef: playProgressSaveStateRef,
    lastSaveTimeRef,
    saveIntervalRef,
    wakeLockRef,
    searchTitle,
    currentSource,
    currentId,
    currentEpisodeIndex,
    detail,
    setCurrentEpisodeIndex,
    cleanupPlayer,
  });

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------

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
      clearTargetEpisodeProgressRef.current = true;
      stableCurrentTimeRef.current = 0;
      resumeTimeRef.current = 0;
      resumeModeRef.current = null;
      // 自动切集后若新一集尚未起播就触发自动换源，相关逻辑会先读 ref。
      // 这里提前同步目标集索引，避免仍按上一集做换源映射。
      currentEpisodeIndexRef.current = targetEpisodeIndex;

      setIsVideoLoading(true);
      setVideoLoadingStage('sourceChanging');
      setVideoLoadingAttempt((prev) => prev + 1);
      setCurrentEpisodeIndex(targetEpisodeIndex);
    },
    [doSaveCurrentProgress],
  );

  const handleEpisodeChange = useCallback(
    (episodeNumber: number) => {
      switchEpisode(episodeNumber);
    },
    [switchEpisode],
  );

  const handlePreviousEpisode = useCallback(() => {
    switchEpisode(currentEpisodeIndexRef.current - 1);
  }, [switchEpisode]);

  const handleNextEpisode = useCallback(() => {
    switchEpisode(currentEpisodeIndexRef.current + 1);
  }, [switchEpisode]);

  // ---------------------------------------------------------------------------
  // 键盘快捷键 hook
  // ---------------------------------------------------------------------------

  usePlayerKeyboard({
    artPlayerRef,
    episodeHandlers: {
      detailRef,
      currentEpisodeIndexRef,
      handlePreviousEpisode,
      handleNextEpisode,
    },
  });

  // ---------------------------------------------------------------------------
  // 收藏 hook
  // ---------------------------------------------------------------------------

  const { handleToggleFavorite } = usePlayFavorite({
    currentSource,
    currentId,
    searchTitle,
    videoTitleRef,
    detailRef,
    currentSourceRef,
    currentIdRef,
    favorited,
    setFavorited,
  });

  // ---------------------------------------------------------------------------
  // 认证恢复
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onSessionLost = (event: Event) => {
      const customEvent = event as CustomEvent<SessionLostDetail>;
      const sessionDetail = customEvent.detail;
      if (!sessionDetail?.inPlayerPage) return;

      doSaveCheckpoint(sessionDetail.reason);

      setAuthRecoveryReason(sessionDetail.reason);
      setAuthRecoveryLoginUrl(sessionDetail.loginUrl);
      setAuthRecoveryVisible(true);
      setIsVideoLoading(false);
      setRealtimeLoadSpeed('');
    };

    window.addEventListener(AUTH_LOST_EVENT, onSessionLost as EventListener);
    return () => {
      window.removeEventListener(
        AUTH_LOST_EVENT,
        onSessionLost as EventListener,
      );
    };
  }, []);

  const getAuthRecoveryMessage = (reason: SessionLostReason) => {
    if (reason === 'user_banned')
      return '账号已被封禁，当前播放已保护。请联系管理员处理后重新登录。';
    if (reason === 'user_not_found')
      return '账号信息失效，当前播放已保护。请重新登录恢复观看。';
    return '登录状态已失效，当前播放进度已保护。重新登录后可自动回到当前位置。';
  };

  const handleReloginAndRecover = () => {
    const target =
      authRecoveryLoginUrl ||
      `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    window.location.href = target;
  };

  // ---------------------------------------------------------------------------
  // 换源
  // ---------------------------------------------------------------------------

  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string,
    options?: { isAutoFallback?: boolean },
  ) => {
    if (
      newSource === currentSourceRef.current &&
      newId === currentIdRef.current
    ) {
      return;
    }

    const isAutoFallback = options?.isAutoFallback === true;

    // 用户主动换源时清空失败记录，让之前 15s 超时被降级掉的源可以重新尝试。
    // 自动降级链路内不能清空，否则连续超时后会重新选回刚失败过的源。
    if (!isAutoFallback) {
      failedSourcesRef.current = new Set();
      // 用户手动选择该源 = 明确想再试一次，同步清掉 sessionStorage 冷却记录
      clearSourceFailure(`${newSource}-${newId}`);
    }
    autoFallbackInProgressRef.current = isAutoFallback;

    const targetSource = availableSources.find(
      (source) => source.source === newSource && source.id === newId,
    );
    if (!targetSource) {
      setError('未找到匹配结果');
      return;
    }

    const currentRequestId = ++sourceChangeRequestIdRef.current;
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
      setRealtimeLoadSpeed('测速中...');
      setError(null);
      setVideoUrl('');

      if (artPlayerRef.current) {
        try {
          artPlayerRef.current.pause();
        } catch (err) {
          console.warn('换源时暂停当前视频失败:', err);
        }
      }
      cleanupPlayer();

      let newDetail = targetSource;

      // 切源前始终走一次 /api/detail 重取最新的 episodes 列表。
      // 列表里的播放地址来自搜索阶段的残留数据，可能是几分钟前甚至更久之前拉到的；
      // 部分源（尤其是 giri、带签名 token 的 CDN）过几分钟就过期，直接复用会触发
      // 15s 加载超时。/api/detail 自身有 SWR 缓存保护，实际回源压力可控。
      try {
        const detailRes = await fetch(
          `/api/detail?source=${newSource}&id=${newId}`,
        );
        if (currentRequestId !== sourceChangeRequestIdRef.current) {
          return;
        }
        if (detailRes.ok) {
          const fullDetail = (await detailRes.json()) as SearchResult;
          if (fullDetail.episodes && fullDetail.episodes.length > 0) {
            newDetail = fullDetail;
            // giri 多版本详情会携带 sibling 版本，一起并回源列表。
            setAvailableSources((prev) => mergeSourceBundle(prev, fullDetail));
          }
        }
      } catch (err) {
        console.error('换源刷新详情失败:', err);
      }

      if (currentRequestId !== sourceChangeRequestIdRef.current) {
        return;
      }

      // 使用 ref 获取最新集数索引，避免闭包捕获到过期的 state 值
      const latestEpisodeIndex = currentEpisodeIndexRef.current;
      const episodeAnchor = resolveSourceSwitchEpisodeAnchor({
        currentAnchor: sourceSwitchEpisodeAnchorRef.current,
        activeDetail: previousDetail,
        activeEpisodeIndex: latestEpisodeIndex,
      });
      sourceSwitchEpisodeAnchorRef.current = episodeAnchor;
      const resolvedEpisodeTarget = resolveEpisodeTargetIndex(
        episodeAnchor.detail,
        episodeAnchor.episodeIndex,
        newDetail,
      );
      let targetIndex = resolvedEpisodeTarget.index;
      let preserveProgress = resolvedEpisodeTarget.preserveProgress;
      // 自动换源的目标仍是“当前这集”，不应继承切集时写下的“从头播放新集”意图。
      const clearTargetEpisodeProgress = isAutoFallback
        ? false
        : clearTargetEpisodeProgressRef.current;

      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
        preserveProgress = false;
      }

      const nextResumeState = resolveSourceSwitchResumeState({
        currentPlayTime,
        preserveProgress,
        clearTargetEpisodeProgress,
      });

      // 写入一次性播放意图，阻止目标源自己的历史记录把刚映射出的目标集覆盖回旧集数。
      savePlayIntent({
        source: newDetail.source,
        id: newDetail.id,
        episodeIndex: targetIndex,
        resumeTime: nextResumeState.resumeTime,
      });

      resumeTimeRef.current = nextResumeState.resumeTime;
      resumeModeRef.current = nextResumeState.resumeMode;

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newDetail.source);
      newUrl.searchParams.set('id', newDetail.id);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newDetail.source);
      setCurrentId(newDetail.id);
      setDetail(newDetail);
      // 同一轮换源后若再次触发自动降级，后续逻辑应继续以当前目标集为准。
      currentEpisodeIndexRef.current = targetIndex;
      setCurrentEpisodeIndex(targetIndex);

      if (
        previousSource &&
        previousId &&
        (previousSource !== newDetail.source || previousId !== newDetail.id)
      ) {
        // 新源真正开始播放后再清理旧记录，避免加载中返回时误删继续观看。
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
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  // 测速补全 detail 后，同步更新 availableSources 中对应条目
  const handleSourceDetailFetched = useCallback((updated: SearchResult) => {
    setAvailableSources((prev) => mergeSourceBundle(prev, updated));
  }, []);

  // 搜索更多源站后，追加到 availableSources（去重）
  const handleAddSources = useCallback((newSources: SearchResult[]) => {
    setAvailableSources((prev) => {
      const existingKeys = new Set(prev.map((s) => `${s.source}-${s.id}`));
      const unique = newSources.filter(
        (s) => !existingKeys.has(`${s.source}-${s.id}`),
      );
      return unique.length > 0 ? [...prev, ...unique] : prev;
    });
  }, []);

  // 把 "1.2MB/s" / "800KB/s" / "4Mbps" 统一成 KB/s 数值，供候选源排序
  const parseLoadSpeedKBps = (speed?: string): number => {
    if (!speed) return 0;
    const match = speed.match(/^([\d.]+)\s*(Mbps|Mb\/s|KB\/s|MB\/s)$/);
    if (!match) return 0;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value <= 0) return 0;
    const unit = match[2];
    if (unit === 'Mbps' || unit === 'Mb/s') return (value * 1024) / 8;
    if (unit === 'MB/s') return value * 1024;
    return value;
  };

  // 15s 加载超时时自动换到下一个候选源：
  // 1. 把当前源加入失败集合；
  // 2. 在 availableSources 中挑选一个不在失败集合里、已测速成功的最优源；
  // 3. 复用 handleSourceChange（置 autoFallbackInProgressRef 标志，避免清空失败集合）。
  const handleLoadingTimeout = useCallback(() => {
    if (!autoSwitchSourceOnTimeout) {
      return;
    }

    const curSource = currentSourceRef.current;
    const curId = currentIdRef.current;
    const curDetail = detailRef.current;
    const curEpisodeIndex = currentEpisodeIndexRef.current;
    if (!curSource || !curId) return;

    const curKey = `${curSource}-${curId}`;
    failedSourcesRef.current.add(curKey);
    // 同步写入 sessionStorage，SourcesTab 排序时据此降权
    markSourceFailed(curKey);

    const candidates = availableSources.filter((s) => {
      const key = `${s.source}-${s.id}`;
      if (key === curKey) return false;
      if (failedSourcesRef.current.has(key)) return false;
      // 自动换源的目标应始终保持在当前逻辑集数；
      // 目标源若连当前集都映射不到，就不要浪费一次 15s 超时窗口去试第 1 集。
      if (curDetail && curEpisodeIndex > 0) {
        const resolved = resolveEpisodeTargetIndex(
          curDetail,
          curEpisodeIndex,
          s,
        );
        if (!resolved.preserveProgress) {
          return false;
        }
      }
      return true;
    });
    if (candidates.length === 0) return;

    // 优先测速过且速度有效的，其次按已有排序顺序
    const ranked = [...candidates].sort((a, b) => {
      const aInfo = precomputedVideoInfo.get(`${a.source}-${a.id}`);
      const bInfo = precomputedVideoInfo.get(`${b.source}-${b.id}`);
      const aSpeed = parseLoadSpeedKBps(aInfo?.loadSpeed);
      const bSpeed = parseLoadSpeedKBps(bInfo?.loadSpeed);
      return bSpeed - aSpeed;
    });
    const next = ranked[0];
    if (!next) return;

    autoFallbackInProgressRef.current = true;
    void handleSourceChange(next.source, next.id, next.title, {
      isAutoFallback: true,
    });
  }, [
    autoSwitchSourceOnTimeout,
    availableSources,
    handleSourceChange,
    precomputedVideoInfo,
  ]);

  useEffect(() => {
    const syncAutoSwitchSetting = () => {
      setAutoSwitchSourceOnTimeout(
        readBooleanLocalSetting(
          AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
          false,
        ),
      );
    };

    const handleLocalSettingChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key !== AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY) {
        return;
      }
      syncAutoSwitchSetting();
    };

    window.addEventListener('storage', syncAutoSwitchSetting);
    window.addEventListener(
      LOCAL_SETTING_CHANGED_EVENT,
      handleLocalSettingChanged,
    );

    return () => {
      window.removeEventListener('storage', syncAutoSwitchSetting);
      window.removeEventListener(
        LOCAL_SETTING_CHANGED_EVENT,
        handleLocalSettingChanged,
      );
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Artplayer hook
  // ---------------------------------------------------------------------------

  useArtPlayer({
    artRef,
    artPlayerRef,
    videoUrl,
    videoCover,
    videoTitle,
    loading,
    detail,
    currentEpisodeIndex,
    totalEpisodes,
    blockAdEnabled,
    blockAdEnabledRef,
    skipConfigRef,
    resumeTimeRef,
    resumeModeRef,
    allowAutoResumeRef,
    stableCurrentTimeRef,
    clearTargetEpisodeProgressRef,
    lastVolumeRef,
    lastPlaybackRateRef,
    lastSkipCheckRef,
    lastSaveTimeRef,
    detailRef,
    currentEpisodeIndexRef,
    wakeLockRef,
    setError,
    setIsVideoLoading,
    setIsPlaying,
    setRealtimeLoadSpeed,
    setBlockAdEnabled,
    handleNextEpisode,
    handleSkipConfigChange,
    saveCurrentPlayProgress: doSaveCurrentProgress,
    requestWakeLock,
    releaseWakeLock,
    cleanupPlayer,
    onSourceProxyFallbackStarted: useCallback(() => {
      // 同源从 browser 切到 server 时，重置 15s 超时窗口，避免尚未重试就被判超时换源。
      setVideoLoadingAttempt((prev) => prev + 1);
    }, []),
    onPlaybackStarted: useCallback(() => {
      const activeSource = currentSourceRef.current;
      const activeId = currentIdRef.current;
      if (!activeSource || !activeId) {
        return;
      }

      // 成功起播：结束自动降级链路，清空失败记录，避免用户下次换源时继续绕开历史源
      autoFallbackInProgressRef.current = false;
      failedSourcesRef.current = new Set();
      clearSourceFailure(`${activeSource}-${activeId}`);
      sourceSwitchEpisodeAnchorRef.current = null;
      clearTargetEpisodeProgressRef.current = false;

      void finalizePendingSourceSwitchCleanup(activeSource, activeId);
    }, [finalizePendingSourceSwitchCleanup]),
    onCurrentSourceVideoInfo: useCallback(
      (info: { quality: string; loadSpeed: string; pingTime: number }) => {
        const src = currentSourceRef.current;
        const id = currentIdRef.current;
        if (!src || !id) return;
        const key = `${src}-${id}`;
        // 播放器实时带宽（hls.js bwEstimate）比探针准确，写入共享 store 优先展示
        writePlayerInfo(key, info);
        setPrecomputedVideoInfo((prev) => {
          const next = new Map(prev);
          next.set(key, info);
          return next;
        });
      },
      [],
    ),
  });

  useEffect(() => {
    return () => {
      // SPA 返回时尽量补一笔最终进度，避免最后几秒丢失。
      doSaveCheckpoint();
      void doSaveCurrentProgress();
    };
  }, [doSaveCheckpoint, doSaveCurrentProgress]);

  // ---------------------------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <PlayLoadingView
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
        onBack={() => router.back()}
      />
    );
  }

  if (error) {
    return (
      <PlayErrorView
        error={error}
        videoTitle={videoTitle}
        onBack={() => window.history.back()}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <PlayMainContent
      videoTitle={videoTitle}
      totalEpisodes={totalEpisodes}
      detail={detail}
      currentEpisodeIndex={currentEpisodeIndex}
      isEpisodeSelectorCollapsed={isEpisodeSelectorCollapsed}
      setIsEpisodeSelectorCollapsed={setIsEpisodeSelectorCollapsed}
      artRef={artRef}
      isVideoLoading={isVideoLoading}
      isPlaying={isPlaying}
      videoLoadingStage={videoLoadingStage}
      videoLoadingAttempt={videoLoadingAttempt}
      realtimeLoadSpeed={realtimeLoadSpeed}
      authRecoveryVisible={authRecoveryVisible}
      authRecoveryReasonMessage={getAuthRecoveryMessage(authRecoveryReason)}
      onReloginAndRecover={handleReloginAndRecover}
      onDismissAuthRecovery={() => setAuthRecoveryVisible(false)}
      onEpisodeChange={handleEpisodeChange}
      onSourceChange={handleSourceChange}
      currentSource={currentSource}
      currentId={currentId}
      searchTitle={searchTitle}
      availableSources={availableSources}
      sourceSearchLoading={sourceSearchLoading}
      sourceSearchError={sourceSearchError}
      precomputedVideoInfo={precomputedVideoInfo}
      videoYear={videoYear}
      favorited={favorited}
      onToggleFavorite={handleToggleFavorite}
      videoCover={videoCover}
      videoDoubanId={videoDoubanId}
      onSourceDetailFetched={handleSourceDetailFetched}
      onAddSources={handleAddSources}
      onLoadingTimeout={handleLoadingTimeout}
      searchType={searchType}
    />
  );
}

function PlayPageContent() {
  const searchParams = useSearchParams();

  // 同一路由下仅查询参数变化时，强制重建播放页状态，
  // 避免上一条播放链路的 ref/state 残留到新视频。
  return <PlayPageClient key={searchParams.toString()} />;
}

// 内部辅助函数（非 export，仅用于 handleSkipConfigChange 回调）
function formatTimeSimple(seconds: number): string {
  if (seconds === 0) return '00:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (hours === 0) {
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <PlayLoadingView
          loadingStage='searching'
          loadingMessage='正在搜索播放源...'
          onBack={() => window.history.back()}
        />
      }
    >
      <PlayPageContent />
    </Suspense>
  );
}
