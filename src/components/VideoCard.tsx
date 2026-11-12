import { useRouter } from 'next/navigation';
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type CardActionAnchor,
  buildCardActions,
} from '@/components/card-actions/actions';
import {
  useCardInteractionManager,
  useFavoriteStatus,
} from '@/components/CardInteractionProvider';
import {
  POSTER_CARD_INTERACTION_CLASS,
  POSTER_CARD_SUBTITLE_ROW_CLASS,
} from '@/components/poster-card-layout';
import { areVideoCardPropsEqual } from '@/components/video-card/compare';
import { noSelectStyle } from '@/components/video-card/constants';
import type {
  VideoCardDisplayConfig,
  VideoCardHandle,
  VideoCardProps,
} from '@/components/video-card/types';
import { VideoCardPoster } from '@/components/video-card/VideoCardPoster';
import { VideoCardTitle } from '@/components/video-card/VideoCardTitle';
import { useOpenWatchRecord } from '@/components/watch-record-context';
import {
  warmupDanmakuForNavigation,
  warmupDanmakuSearchForNavigation,
} from '@/features/play/lib/danmaku/navigation-warmup';
import { useLongPress } from '@/hooks/useLongPress';
import { buildExternalSubjectUrl } from '@/hooks/usePosterPlay';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { isCatalogFavoriteSource } from '@/lib/catalog-favorites';
import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  getFavoriteForWork,
  markPlayRecordUpdateRead,
  saveFavorite,
  setPlayRecordTracking,
} from '@/lib/db.client';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { savePlayIntent } from '@/lib/play-intent';
import { hasPlayRecordUpdate, isTrackingEnabled } from '@/lib/play-records';
import { showToast } from '@/lib/toast';
import { parseStorageKey } from '@/lib/utils';
import {
  canUseHoverPrefetch,
  canUseNetworkPrefetch,
  findLocalPlaybackTargetByTitle,
  PREFETCH_INTENT_DELAY_MS,
  transferWarmedSearchToAggregateGroup,
  warmupForPlayback,
  warmupSearchForTitle,
} from '@/lib/video-prefetch';
export type {
  VideoCardHandle,
  VideoCardProps,
} from '@/components/video-card/types';

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(
  function VideoCard(
    {
      id,
      title = '',
      query = '',
      poster = '',
      priority = false,
      episodes,
      source,
      source_name,
      source_names,
      progress = 0,
      resumeTime,
      year,
      from,
      currentEpisode,
      hasUpdate = false,
      trackingEnabled = true,
      availableEpisodes,
      resumeEpisodeIndex,
      resumeGroup,
      douban_id,
      onDelete,
      rate,
      myRating,
      type = '',
      isBangumi = false,
      isAggregate = false,
      origin = 'vod',
      aggregateGroup,
    }: VideoCardProps,
    ref,
  ) {
    const router = useRouter();
    const interactionId = useId();
    const openWatchRecord = useOpenWatchRecord();
    const prefetchTimerRef = useRef<number | null>(null);
    const {
      showActionSheet,
      hideActionSheet,
      showConfirm,
      ensureFavoritesLoaded,
      getFavoriteStatus,
    } = useCardInteractionManager();
    const [showMobileActions, setShowMobileActions] = useState(false);
    const [actionSheetAnchorRect, setActionSheetAnchorRect] =
      useState<CardActionAnchor | null>(null);
    const [searchFavorited, setSearchFavorited] = useState<boolean | null>(
      null,
    ); // 搜索结果的收藏状态
    const [visibleHasUpdate, setVisibleHasUpdate] = useState(hasUpdate);
    const [visibleTrackingEnabled, setVisibleTrackingEnabled] =
      useState(trackingEnabled);
    // 可外部修改的可控字段
    const [dynamicEpisodes, setDynamicEpisodes] = useState<number | undefined>(
      episodes,
    );
    const [dynamicSourceNames, setDynamicSourceNames] = useState<
      string[] | undefined
    >(source_names);
    const [dynamicDoubanId, setDynamicDoubanId] = useState<number | undefined>(
      douban_id,
    );

    useEffect(() => {
      setDynamicEpisodes(episodes);
    }, [episodes]);

    useEffect(() => {
      setDynamicSourceNames(source_names);
    }, [source_names]);

    useEffect(() => {
      setDynamicDoubanId(douban_id);
    }, [douban_id]);

    useEffect(() => {
      setVisibleHasUpdate(hasUpdate);
    }, [hasUpdate]);

    useEffect(() => {
      setVisibleTrackingEnabled(trackingEnabled);
    }, [trackingEnabled]);

    useImperativeHandle(ref, () => ({
      setEpisodes: (eps?: number) => setDynamicEpisodes(eps),
      setSourceNames: (names?: string[]) => setDynamicSourceNames(names),
      setDoubanId: (id?: number) => setDynamicDoubanId(id),
    }));

    const actualTitle = title;
    const actualPoster = poster;
    const actualSource = source;
    const actualId = id;
    const actualDoubanId = dynamicDoubanId;
    const actualEpisodes = dynamicEpisodes;
    const actualYear = normalizeCardYear(year);
    const aggregateSourceNames = useMemo(
      () =>
        isAggregate
          ? Array.from(new Set(dynamicSourceNames ?? [])).filter(Boolean)
          : [],
      [dynamicSourceNames, isAggregate],
    );
    const actualQuery = query || '';
    // 豆瓣卡片与目录收藏没有可播放源，按标题搜索起播
    const playsByTitle =
      from === 'douban' ||
      (from === 'favorite' && isCatalogFavoriteSource(actualSource ?? ''));
    const actualSearchType = isAggregate
      ? actualEpisodes && actualEpisodes === 1
        ? 'movie'
        : 'tv'
      : type;
    const favoriteStorageKey = useMemo(() => {
      if (!actualSource || !actualId) {
        return null;
      }

      return generateStorageKey(actualSource, actualId);
    }, [actualId, actualSource]);
    const shouldTrackFavoriteStatus =
      from === 'playrecord' && !!favoriteStorageKey;
    const favorited = useFavoriteStatus(
      actualSource,
      actualId,
      shouldTrackFavoriteStatus,
    );
    const visibleFavorited = from === 'favorite' ? true : favorited;
    // 多源聚合卡片代表作品而非某个源：收藏与标记落到排序第一的源，收藏状态按作品身份查询
    const aggregateLead =
      from === 'search' && isAggregate && !actualSource && !actualId
        ? aggregateGroup?.[0]
        : undefined;
    const [workFavoriteKey, setWorkFavoriteKey] = useState<string | null>(null);
    const workFavoriteRequestRef = useRef(0);

    const loadWorkFavoriteStatus = useCallback(async () => {
      if (!aggregateLead) return;
      const request = ++workFavoriteRequestRef.current;
      try {
        const entry = await getFavoriteForWork({
          key: generateStorageKey(aggregateLead.source, aggregateLead.id),
          title: actualTitle,
          year: actualYear,
        });
        if (request !== workFavoriteRequestRef.current) return;
        setWorkFavoriteKey(entry?.key ?? null);
        setSearchFavorited(Boolean(entry));
      } catch {
        if (request === workFavoriteRequestRef.current) {
          setSearchFavorited((current) => current ?? false);
        }
      }
    }, [aggregateLead, actualTitle, actualYear]);

    const toggleWorkFavorite = useCallback(async () => {
      if (!aggregateLead) return;
      // 让切换前发出的状态查询作废，避免旧结果覆盖切换后的状态
      workFavoriteRequestRef.current += 1;
      const existing = workFavoriteKey
        ? parseStorageKey(workFavoriteKey)
        : null;
      if (existing) {
        await deleteFavorite(existing.source, existing.id);
        setWorkFavoriteKey(null);
        setSearchFavorited(false);
        return false;
      }
      const key = await saveFavorite(aggregateLead.source, aggregateLead.id, {
        title: actualTitle,
        source_name: aggregateLead.source_name || '',
        year: actualYear,
        cover: actualPoster || aggregateLead.poster,
        total_episodes: aggregateLead.episodes.length || actualEpisodes || 1,
        save_time: Date.now(),
      });
      setWorkFavoriteKey(key);
      setSearchFavorited(true);
      return true;
    }, [
      aggregateLead,
      workFavoriteKey,
      actualTitle,
      actualYear,
      actualPoster,
      actualEpisodes,
    ]);

    const loadFavoriteStatus = useCallback(async () => {
      if (!favoriteStorageKey || from === 'douban') {
        return false;
      }

      await ensureFavoritesLoaded();
      const nextFavorited = getFavoriteStatus(favoriteStorageKey);

      if (from === 'search') {
        setSearchFavorited(nextFavorited);
      }

      return nextFavorited;
    }, [ensureFavoritesLoaded, favoriteStorageKey, from, getFavoriteStatus]);

    const handleToggleFavorite = useCallback(
      async (e: React.MouseEvent, onSuccess?: (favorited: boolean) => void) => {
        e.preventDefault();
        e.stopPropagation();
        if (aggregateLead) {
          try {
            const nextFavorited = await toggleWorkFavorite();
            if (nextFavorited !== undefined) onSuccess?.(nextFavorited);
          } catch {
            throw new Error('切换收藏状态失败');
          }
          return;
        }
        if (from === 'douban' || !actualSource || !actualId) return;

        try {
          let currentFavorited: boolean;

          if (from === 'favorite') {
            currentFavorited = true;
          } else if (from === 'search' && searchFavorited !== null) {
            currentFavorited = searchFavorited;
          } else {
            currentFavorited = await loadFavoriteStatus();
          }

          if (currentFavorited) {
            if (from === 'favorite' || from === 'playrecord') {
              showConfirm(interactionId, {
                objectKey: `${actualSource}+${actualId}`,
                operation: 'favorite',
                title: '确认取消收藏？',
                message: `确认取消收藏「${actualTitle}」吗？`,
                danger: true,
                cancelText: '再想想',
                confirmText: '取消收藏',
                onConfirm: async () => {
                  await deleteFavorite(actualSource, actualId);
                  onSuccess?.(false);
                },
              });
              return;
            }
            await deleteFavorite(actualSource, actualId);
            if (from === 'search') {
              setSearchFavorited(false);
            }
          } else {
            // 如果未收藏，添加收藏
            await saveFavorite(actualSource, actualId, {
              title: actualTitle,
              source_name: source_name || '',
              year: actualYear || '',
              cover: actualPoster,
              total_episodes: actualEpisodes ?? 1,
              save_time: Date.now(),
            });
            if (from === 'search') {
              setSearchFavorited(true);
            }
          }
          onSuccess?.(!currentFavorited);
        } catch {
          throw new Error('切换收藏状态失败');
        }
      },
      [
        from,
        actualSource,
        actualId,
        actualTitle,
        source_name,
        actualYear,
        actualPoster,
        actualEpisodes,
        searchFavorited,
        showConfirm,
        interactionId,
        loadFavoriteStatus,
        aggregateLead,
        toggleWorkFavorite,
      ],
    );

    const handleDeleteRecord = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (from !== 'playrecord' || !actualSource || !actualId) return;

        showConfirm(interactionId, {
          title: '确认删除该记录？',
          message: `确认删除「${actualTitle}」的观看记录吗？删除后无法恢复。`,
          danger: true,
          cancelText: '取消',
          confirmText: '确认删除',
          onConfirm: async () => {
            await deletePlayRecord(actualSource, actualId);
            onDelete?.();
          },
        });
      },
      [
        from,
        actualSource,
        actualId,
        showConfirm,
        interactionId,
        actualTitle,
        onDelete,
      ],
    );

    // 聚合模式跳转前，把完整的 group 数据写入 sessionStorage 供播放页复用
    const saveAggregateGroup = useCallback(() => {
      if (isAggregate && aggregateGroup && aggregateGroup.length > 0) {
        try {
          sessionStorage.setItem(
            'aggregate_group',
            JSON.stringify(aggregateGroup),
          );
        } catch {
          // sessionStorage 写入失败（如隐私模式容量满），静默忽略
        }
      }
    }, [isAggregate, aggregateGroup]);

    const posterAlternates = useMemo(
      () =>
        isAggregate && aggregateGroup && aggregateGroup.length > 1
          ? aggregateGroup.map((item) => item.poster)
          : undefined,
      [isAggregate, aggregateGroup],
    );

    const isSingleAggregate = isAggregate && aggregateGroup?.length === 1;
    const aggregateSourceCount = isAggregate
      ? new Set((aggregateGroup || []).map((item) => item.source)).size
      : 0;
    const isDirectStartup =
      origin === 'vod' &&
      ((from === 'playrecord' && !isAggregate) ||
        (from === 'search' && (!isAggregate || aggregateSourceCount === 1)));

    /** 根据卡片数据构建目标 URL，返回 null 表示无有效跳转 */
    const buildPlayUrl = useCallback((): string | null => {
      if (origin === 'live' && actualSource && actualId) {
        return `/live?source=${actualSource.replace(
          'live_',
          '',
        )}&id=${actualId.replace('live_', '')}`;
      }
      if (playsByTitle) {
        const localTarget = findLocalPlaybackTargetByTitle(
          actualTitle,
          actualYear,
        );
        if (localTarget) {
          return `/play?source=${encodeURIComponent(localTarget.source)}&id=${encodeURIComponent(
            localTarget.id,
          )}&title=${encodeURIComponent(actualTitle.trim())}${
            actualYear ? `&year=${actualYear}` : ''
          }${actualSearchType ? `&stype=${actualSearchType}` : ''}${
            actualQuery
              ? `&stitle=${encodeURIComponent(actualQuery.trim())}`
              : ''
          }`;
        }
      }
      if (playsByTitle || (isAggregate && !actualSource && !actualId)) {
        saveAggregateGroup();
        return `/play?title=${encodeURIComponent(actualTitle.trim())}${
          actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}${
          isAggregate && !isSingleAggregate ? '&prefer=true' : ''
        }${isSingleAggregate ? '&singleSource=true' : ''}${
          isDirectStartup ? '&directStart=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }`;
      }
      if (actualSource && actualId) {
        return `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
          actualTitle,
        )}${actualYear ? `&year=${actualYear}` : ''}${
          isAggregate && !isSingleAggregate ? '&prefer=true' : ''
        }${isSingleAggregate ? '&singleSource=true' : ''}${
          isDirectStartup ? '&directStart=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;
      }
      return null;
    }, [
      origin,
      playsByTitle,
      actualSource,
      actualId,
      actualTitle,
      actualYear,
      isAggregate,
      isSingleAggregate,
      isDirectStartup,
      actualQuery,
      actualSearchType,
      saveAggregateGroup,
    ]);

    const warmupDanmaku = useCallback(() => {
      const localTarget = playsByTitle
        ? findLocalPlaybackTargetByTitle(actualTitle, actualYear)
        : null;
      void warmupDanmakuForNavigation({
        source:
          isAggregate || (playsByTitle && !localTarget)
            ? ''
            : (localTarget?.source ?? actualSource ?? ''),
        videoId:
          isAggregate || (playsByTitle && !localTarget)
            ? ''
            : (localTarget?.id ?? actualId ?? ''),
        episodeIndex:
          from === 'playrecord'
            ? (resumeEpisodeIndex ?? Math.max(0, (currentEpisode || 1) - 1))
            : 0,
        searchTitle: actualTitle,
        searchYear: actualYear || '',
      });
    }, [
      playsByTitle,
      actualId,
      actualSource,
      actualTitle,
      actualYear,
      currentEpisode,
      from,
      isAggregate,
      resumeEpisodeIndex,
    ]);

    // 点击时同时预热播放详情、聚合搜索和弹幕数据
    const warmupOnNavigate = useCallback(() => {
      if (origin === 'live') return;
      if (!canUseNetworkPrefetch()) return;

      warmupDanmaku();
      if (isAggregate) return;

      if (playsByTitle || !actualSource || !actualId) {
        if (!findLocalPlaybackTargetByTitle(actualTitle, actualYear)) {
          transferWarmedSearchToAggregateGroup(actualQuery || actualTitle);
        }
        warmupSearchForTitle(actualQuery || actualTitle);
        return;
      }
      warmupForPlayback(actualSource, actualId);
    }, [
      playsByTitle,
      origin,
      isAggregate,
      actualSource,
      actualId,
      actualQuery,
      actualTitle,
      actualYear,
      warmupDanmaku,
    ]);

    const handleClick = useCallback(() => {
      const url = buildPlayUrl();
      if (!url) return;

      const authInfo = getAuthInfoFromBrowserCookie();
      if (authInfo?.username) {
        if (
          from === 'playrecord' &&
          actualSource &&
          actualId &&
          currentEpisode &&
          Number.isFinite(resumeTime) &&
          (resumeTime || 0) > 0
        ) {
          savePlayIntent({
            source: actualSource,
            id: actualId,
            episodeIndex: resumeEpisodeIndex ?? Math.max(0, currentEpisode - 1),
            resumeTime: resumeTime || 0,
            groupLabel: resumeGroup?.label,
            groupIndex: resumeGroup?.index,
            groupTotal: resumeGroup?.total,
          });
        }

        warmupOnNavigate();
      }

      router.push(withReturnTo(url, getCurrentNavigationPath()));
    }, [
      router,
      buildPlayUrl,
      from,
      actualSource,
      actualId,
      currentEpisode,
      resumeEpisodeIndex,
      resumeGroup,
      resumeTime,
      warmupOnNavigate,
    ]);

    // hover / focus 预热：带 source+id 的卡片预取 detail，并提前准备弹幕候选
    const handlePrefetch = useCallback(() => {
      if (shouldTrackFavoriteStatus) {
        void loadFavoriteStatus();
      }

      if (origin === 'live') return;
      if (!canUseHoverPrefetch()) return;

      router.prefetch('/play');
      if (prefetchTimerRef.current) {
        window.clearTimeout(prefetchTimerRef.current);
      }
      prefetchTimerRef.current = window.setTimeout(() => {
        prefetchTimerRef.current = null;
        void warmupDanmakuSearchForNavigation(actualTitle);
        if (isAggregate) return;
        if (playsByTitle || !actualSource || !actualId) {
          warmupSearchForTitle(actualQuery || actualTitle);
          return;
        }
        warmupForPlayback(actualSource, actualId);
      }, PREFETCH_INTENT_DELAY_MS);
    }, [
      playsByTitle,
      actualId,
      actualSource,
      actualQuery,
      actualTitle,
      isAggregate,
      loadFavoriteStatus,
      origin,
      router,
      shouldTrackFavoriteStatus,
    ]);

    const cancelPrefetch = useCallback(() => {
      if (!prefetchTimerRef.current) return;
      window.clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }, []);

    useEffect(() => cancelPrefetch, [cancelPrefetch]);

    const handleMarkUpdateRead = useCallback(
      async (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (from !== 'playrecord' || !actualSource || !actualId) return;

        await markPlayRecordUpdateRead(actualSource, actualId);
        setVisibleHasUpdate(false);
      },
      [actualId, actualSource, from],
    );

    const handleToggleTracking = useCallback(async () => {
      if (from !== 'playrecord' || !actualSource || !actualId) return;

      const record = await setPlayRecordTracking(
        actualSource,
        actualId,
        !visibleTrackingEnabled,
      );
      setVisibleTrackingEnabled(isTrackingEnabled(record));
      setVisibleHasUpdate(hasPlayRecordUpdate(record));
      showToast(
        isTrackingEnabled(record) ? '已开启追更' : '已取消追更',
        'success',
      );
    }, [actualId, actualSource, from, visibleTrackingEnabled]);

    // 检查搜索结果的收藏状态
    const checkSearchFavoriteStatus = useCallback(async () => {
      if (from === 'search' && favoriteStorageKey && searchFavorited === null) {
        try {
          await loadFavoriteStatus();
        } catch {
          setSearchFavorited(false);
        }
      }
    }, [from, favoriteStorageKey, searchFavorited, loadFavoriteStatus]);

    const requestVisibleFavoriteStatus = useCallback(() => {
      // 作品可能经播放页或标记面板在其他源收藏，每次打开菜单都重新查询
      if (aggregateLead) {
        void loadWorkFavoriteStatus();
        return;
      }
      if (from === 'search') {
        void checkSearchFavoriteStatus();
        return;
      }

      if (shouldTrackFavoriteStatus) {
        void loadFavoriteStatus();
      }
    }, [
      aggregateLead,
      checkSearchFavoriteStatus,
      from,
      loadFavoriteStatus,
      loadWorkFavoriteStatus,
      shouldTrackFavoriteStatus,
    ]);

    const closeActionSheet = useCallback(() => {
      setShowMobileActions(false);
      setActionSheetAnchorRect(null);
    }, []);

    // 长按操作
    const handleLongPress = useCallback(() => {
      if (!showMobileActions) {
        // 防止重复触发
        // 立即显示菜单，避免等待数据加载导致动画卡顿
        setActionSheetAnchorRect(null);
        setShowMobileActions(true);

        requestVisibleFavoriteStatus();
      }
    }, [showMobileActions, requestVisibleFavoriteStatus]);

    // 长按手势hook
    const longPressProps = useLongPress({
      onLongPress: handleLongPress,
      onClick: handleClick, // 保持点击播放功能
      longPressDelay: 500,
    });

    const config = useMemo<VideoCardDisplayConfig>(() => {
      const configs = {
        playrecord: {
          showSourceName: true,
          showProgress: true,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: true,
          showDoubanLink: false,
          showRating: false,
          showYear: false,
        },
        favorite: {
          showSourceName: true,
          showProgress: true,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: false,
          showDoubanLink: false,
          showRating: false,
          showYear: false,
        },
        search: {
          showSourceName: true,
          showProgress: false,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: false,
          showDoubanLink: true,
          showRating: false,
          showYear: true,
        },
        douban: {
          showSourceName: false,
          showProgress: false,
          showPlayButton: true,
          showHeart: false,
          showCheckCircle: false,
          showDoubanLink: true,
          showRating: !!rate,
          showYear: false,
        },
      };
      return configs[from] || configs.search;
    }, [from, rate]);

    // 菜单操作项
    const buildMobileActions = useCallback(() => {
      // 菜单回调没有原生事件，复用卡片按钮的事件处理函数
      const noopEvent = {
        preventDefault: () => {},
        stopPropagation: () => {},
      } as React.MouseEvent;
      const hasRecordTarget = Boolean(actualSource && actualId);

      const recordTarget =
        from === 'douban'
          ? actualDoubanId
            ? {
                source: isBangumi ? 'bangumi' : 'douban',
                id: String(actualDoubanId),
                sourceName: isBangumi ? 'Bangumi' : '豆瓣',
              }
            : null
          : hasRecordTarget && actualSource && actualId
            ? {
                source: actualSource,
                id: actualId,
                sourceName: source_name || '',
              }
            : aggregateLead
              ? {
                  source: aggregateLead.source,
                  id: aggregateLead.id,
                  sourceName: aggregateLead.source_name || '',
                }
              : null;
      const externalUrl = config.showDoubanLink
        ? buildExternalSubjectUrl(actualDoubanId, isBangumi)
        : null;

      return buildCardActions({
        play: config.showPlayButton
          ? {
              live: origin === 'live',
              onClick: handleClick,
            }
          : undefined,
        favorite:
          config.showHeart &&
          from !== 'douban' &&
          (hasRecordTarget || aggregateLead)
            ? {
                favorited:
                  from === 'search' ? searchFavorited : visibleFavorited,
                onToggle: () =>
                  handleToggleFavorite(noopEvent, (nextFavorited) => {
                    if (from === 'favorite' && !nextFavorited) return;
                    showToast(
                      nextFavorited ? '已加入收藏' : '已取消收藏',
                      'success',
                    );
                  }),
              }
            : undefined,
        watchRecord:
          openWatchRecord && origin !== 'live' && recordTarget
            ? () =>
                openWatchRecord({
                  ...recordTarget,
                  feedback: {
                    watchStateVisible: from === 'favorite',
                    favoriteVisible: from === 'favorite',
                  },
                  title: actualTitle,
                  year: actualYear,
                  cover: actualPoster,
                  totalEpisodes: actualEpisodes,
                  searchTitle: actualQuery || undefined,
                  doubanId: actualDoubanId,
                })
            : null,
        updates:
          from === 'playrecord' && hasRecordTarget
            ? {
                hasUpdate: visibleHasUpdate,
                onMarkRead: () => handleMarkUpdateRead(noopEvent),
                tracking: visibleTrackingEnabled,
                onToggleTracking: handleToggleTracking,
              }
            : undefined,
        external: externalUrl ? { url: externalUrl, bangumi: isBangumi } : null,
        remove:
          config.showCheckCircle && from === 'playrecord' && hasRecordTarget
            ? () => handleDeleteRecord(noopEvent)
            : undefined,
      });
    }, [
      config,
      from,
      actualSource,
      actualId,
      actualEpisodes,
      visibleFavorited,
      searchFavorited,
      visibleHasUpdate,
      actualDoubanId,
      isBangumi,
      handleClick,
      visibleTrackingEnabled,
      handleToggleTracking,
      handleToggleFavorite,
      handleMarkUpdateRead,
      handleDeleteRecord,
      origin,
      openWatchRecord,
      source_name,
      actualTitle,
      actualYear,
      actualPoster,
      actualQuery,
      aggregateLead,
    ]);

    useEffect(() => {
      if (!showMobileActions) {
        hideActionSheet(interactionId);
        return;
      }

      showActionSheet(
        interactionId,
        {
          objectKey: favoriteStorageKey ?? `work:${actualTitle}:${actualYear}`,
          title: actualTitle,
          poster: actualPoster,
          actions: buildMobileActions(),
          sources: isAggregate ? dynamicSourceNames : undefined,
          sourceName: source_name,
          origin,
          anchorRect: actionSheetAnchorRect,
        },
        closeActionSheet,
      );

      return () => {
        hideActionSheet(interactionId);
      };
    }, [
      actionSheetAnchorRect,
      actualYear,
      favoriteStorageKey,
      actualPoster,
      actualTitle,
      buildMobileActions,
      closeActionSheet,
      dynamicSourceNames,
      hideActionSheet,
      interactionId,
      isAggregate,
      origin,
      showActionSheet,
      showMobileActions,
      source_name,
    ]);

    return (
      <>
        <div
          className={`${POSTER_CARD_INTERACTION_CLASS} ${from === 'search' ? 'animate-fade-in' : ''}`}
          onClick={handleClick}
          onMouseEnter={handlePrefetch}
          onMouseLeave={cancelPrefetch}
          onFocus={handlePrefetch}
          onBlur={cancelPrefetch}
          {...longPressProps}
          style={
            {
              ...noSelectStyle,
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              pointerEvents: 'auto',
            } as React.CSSProperties
          }
          onContextMenu={(e) => {
            // 阻止默认右键菜单
            e.preventDefault();
            e.stopPropagation();

            // 右键菜单在光标处展开
            setActionSheetAnchorRect({
              top: e.clientY,
              left: e.clientX,
              width: 0,
              height: 0,
            });
            setShowMobileActions(true);

            requestVisibleFavoriteStatus();

            return false;
          }}
          onDragStart={(e) => {
            // 阻止拖拽
            e.preventDefault();
            return false;
          }}
        >
          <VideoCardPoster
            title={actualTitle}
            poster={actualPoster}
            posterAlternates={posterAlternates}
            priority={priority}
            origin={origin}
            from={from}
            config={config}
            sourceName={source_name}
            rate={rate}
            myRating={myRating}
            episodes={actualEpisodes}
            currentEpisode={currentEpisode}
            hasUpdate={visibleHasUpdate}
            availableEpisodes={availableEpisodes}
            progress={progress}
            visibleFavorited={visibleFavorited}
            onToggleFavorite={handleToggleFavorite}
            onMarkUpdateRead={handleMarkUpdateRead}
          />

          <VideoCardTitle title={actualTitle} />
          {config.showYear && (
            <p
              data-card-subtitle
              className={`${POSTER_CARD_SUBTITLE_ROW_CLASS} truncate text-gray-500 dark:text-gray-400`}
              title={
                aggregateSourceNames.length > 1
                  ? aggregateSourceNames.join('、')
                  : undefined
              }
              style={noSelectStyle}
            >
              {[
                actualYear,
                aggregateSourceNames.length > 1
                  ? `${aggregateSourceNames.length} 个源`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ') || ' '}
            </p>
          )}
        </div>
      </>
    );
  },
);

function normalizeCardYear(year?: string): string {
  const normalizedYear = String(year ?? '').trim();
  if (
    !normalizedYear ||
    normalizedYear === 'unknown' ||
    normalizedYear === '0'
  ) {
    return '';
  }
  return normalizedYear;
}

export default memo(VideoCard, areVideoCardPropsEqual);
