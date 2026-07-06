import {
  ExternalLink,
  Heart,
  Link,
  PlayCircleIcon,
  Trash2,
} from 'lucide-react';
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
  useCardInteractionManager,
  useFavoriteStatus,
} from '@/components/CardInteractionProvider';
import { areVideoCardPropsEqual } from '@/components/video-card/compare';
import { noSelectStyle } from '@/components/video-card/constants';
import type {
  VideoCardDisplayConfig,
  VideoCardHandle,
  VideoCardProps,
} from '@/components/video-card/types';
import { VideoCardPoster } from '@/components/video-card/VideoCardPoster';
import { VideoCardTitle } from '@/components/video-card/VideoCardTitle';
import { useLongPress } from '@/hooks/useLongPress';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  saveFavorite,
} from '@/lib/db.client';
import { savePlayIntent } from '@/lib/play-intent';
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
      douban_id,
      onDelete,
      rate,
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
    const prefetchTimerRef = useRef<number | null>(null);
    const {
      showActionSheet,
      hideActionSheet,
      showConfirm,
      ensureFavoritesLoaded,
      getFavoriteStatus,
    } = useCardInteractionManager();
    const [showMobileActions, setShowMobileActions] = useState(false);
    const [actionSheetAnchorRect, setActionSheetAnchorRect] = useState<{
      top: number;
      left: number;
      width: number;
      height: number;
    } | null>(null);
    const [searchFavorited, setSearchFavorited] = useState<boolean | null>(
      null,
    ); // 搜索结果的收藏状态
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
    const actualYear = year;
    const actualQuery = query || '';
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
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
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
            // 收藏页取消收藏需要二次确认
            if (from === 'favorite') {
              showConfirm(interactionId, {
                title: '确认取消收藏？',
                message: `确认取消收藏「${actualTitle}」吗？`,
                danger: true,
                cancelText: '再想想',
                confirmText: '取消收藏',
                onConfirm: async () => {
                  await deleteFavorite(actualSource, actualId);
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
        } catch (err) {
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

    /** 根据卡片数据构建目标 URL，返回 null 表示无有效跳转 */
    const buildPlayUrl = useCallback((): string | null => {
      if (origin === 'live' && actualSource && actualId) {
        return `/live?source=${actualSource.replace(
          'live_',
          '',
        )}&id=${actualId.replace('live_', '')}`;
      }
      if (from === 'douban') {
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
      if (from === 'douban' || (isAggregate && !actualSource && !actualId)) {
        saveAggregateGroup();
        return `/play?title=${encodeURIComponent(actualTitle.trim())}${
          actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}${
          isAggregate ? '&prefer=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }`;
      }
      if (actualSource && actualId) {
        return `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
          actualTitle,
        )}${actualYear ? `&year=${actualYear}` : ''}${
          isAggregate ? '&prefer=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;
      }
      return null;
    }, [
      origin,
      from,
      actualSource,
      actualId,
      actualTitle,
      actualYear,
      isAggregate,
      actualQuery,
      actualSearchType,
      saveAggregateGroup,
    ]);

    /** 未登录时返回登录跳转 URL */
    const getLoginRedirectUrl = () => {
      const currentUrl = window.location.pathname + window.location.search;
      return `/login?redirect=${encodeURIComponent(currentUrl)}`;
    };

    // 点击时预热：聚合卡数据经 sessionStorage 传递，跳过
    const warmupOnNavigate = useCallback(() => {
      if (origin === 'live' || isAggregate) return;
      if (!canUseNetworkPrefetch()) return;

      if (from === 'douban' || !actualSource || !actualId) {
        if (!findLocalPlaybackTargetByTitle(actualTitle, actualYear)) {
          transferWarmedSearchToAggregateGroup(actualQuery || actualTitle);
        }
        warmupSearchForTitle(actualQuery || actualTitle);
        return;
      }
      warmupForPlayback(actualSource, actualId);
    }, [
      origin,
      isAggregate,
      from,
      actualSource,
      actualId,
      actualQuery,
      actualTitle,
      actualYear,
    ]);

    const handleClick = useCallback(() => {
      const authInfo = getAuthInfoFromBrowserCookie();
      if (!authInfo?.username) {
        router.push(getLoginRedirectUrl());
        return;
      }

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
          episodeIndex: Math.max(0, currentEpisode - 1),
          resumeTime: resumeTime || 0,
        });
      }

      warmupOnNavigate();
      const url = buildPlayUrl();
      if (url) router.push(url);
    }, [
      router,
      buildPlayUrl,
      from,
      actualSource,
      actualId,
      currentEpisode,
      resumeTime,
      warmupOnNavigate,
    ]);

    // hover / focus 预热：带 source+id 的卡片预取 detail，豆瓣卡预热标题搜索
    const handlePrefetch = useCallback(() => {
      if (shouldTrackFavoriteStatus) {
        void loadFavoriteStatus();
      }

      if (origin === 'live') return;
      if (isAggregate) return;
      if (!canUseHoverPrefetch()) return;

      router.prefetch('/play');
      if (prefetchTimerRef.current) {
        window.clearTimeout(prefetchTimerRef.current);
      }
      prefetchTimerRef.current = window.setTimeout(() => {
        prefetchTimerRef.current = null;
        if (from === 'douban' || !actualSource || !actualId) {
          warmupSearchForTitle(actualQuery || actualTitle);
          return;
        }
        warmupForPlayback(actualSource, actualId);
      }, PREFETCH_INTENT_DELAY_MS);
    }, [
      actualId,
      actualSource,
      actualQuery,
      actualTitle,
      from,
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

    // 新标签页播放处理函数
    const handlePlayInNewTab = useCallback(() => {
      const authInfo = getAuthInfoFromBrowserCookie();
      if (!authInfo?.username) {
        window.open(getLoginRedirectUrl(), '_blank');
        return;
      }
      const url = buildPlayUrl();
      if (url) window.open(url, '_blank');
    }, [buildPlayUrl]);

    // 检查搜索结果的收藏状态
    const checkSearchFavoriteStatus = useCallback(async () => {
      if (
        from === 'search' &&
        !isAggregate &&
        favoriteStorageKey &&
        searchFavorited === null
      ) {
        try {
          await loadFavoriteStatus();
        } catch (err) {
          setSearchFavorited(false);
        }
      }
    }, [
      from,
      isAggregate,
      favoriteStorageKey,
      searchFavorited,
      loadFavoriteStatus,
    ]);

    const requestVisibleFavoriteStatus = useCallback(() => {
      if (from === 'search') {
        void checkSearchFavoriteStatus();
        return;
      }

      if (shouldTrackFavoriteStatus) {
        void loadFavoriteStatus();
      }
    }, [
      checkSearchFavoriteStatus,
      from,
      loadFavoriteStatus,
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
          showHeart: true, // 移动端菜单中需要显示收藏选项
          showCheckCircle: false,
          showDoubanLink: true, // 移动端菜单中显示豆瓣链接
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
    }, [from, isAggregate, douban_id, rate]);

    // 菜单操作项按需构建：仅在用户触发菜单时计算，避免每个卡片实例挂载时的开销
    const buildMobileActions = useCallback(() => {
      const actions = [];

      // 播放操作
      if (config.showPlayButton) {
        actions.push({
          id: 'play',
          label: origin === 'live' ? '观看直播' : '播放',
          icon: <PlayCircleIcon size={20} />,
          onClick: handleClick,
          color: 'primary' as const,
        });

        // 新标签页播放
        actions.push({
          id: 'play-new-tab',
          label: origin === 'live' ? '新标签页观看' : '新标签页播放',
          icon: <ExternalLink size={20} />,
          onClick: handlePlayInNewTab,
          color: 'default' as const,
        });
      }

      // 聚合源信息 - 直接在菜单中展示，不需要单独的操作项

      // 收藏/取消收藏操作
      if (config.showHeart && from !== 'douban' && actualSource && actualId) {
        const currentFavorited =
          from === 'search' ? searchFavorited : visibleFavorited;

        if (from === 'search') {
          // 搜索结果：根据加载状态显示不同的选项
          if (searchFavorited !== null) {
            // 已加载完成，显示实际的收藏状态
            actions.push({
              id: 'favorite',
              label: currentFavorited ? '取消收藏' : '添加收藏',
              icon: currentFavorited ? (
                <Heart size={20} className='fill-red-600 stroke-red-600' />
              ) : (
                <Heart size={20} className='fill-transparent stroke-red-500' />
              ),
              onClick: () => {
                const mockEvent = {
                  preventDefault: () => {},
                  stopPropagation: () => {},
                } as React.MouseEvent;
                handleToggleFavorite(mockEvent);
              },
              color: currentFavorited
                ? ('danger' as const)
                : ('default' as const),
            });
          } else {
            // 正在加载中，显示占位项
            actions.push({
              id: 'favorite-loading',
              label: '收藏加载中...',
              icon: <Heart size={20} />,
              onClick: () => {}, // 加载中时不响应点击
              disabled: true,
            });
          }
        } else {
          // 非搜索结果：直接显示收藏选项
          actions.push({
            id: 'favorite',
            label: currentFavorited ? '取消收藏' : '添加收藏',
            icon: currentFavorited ? (
              <Heart size={20} className='fill-red-600 stroke-red-600' />
            ) : (
              <Heart size={20} className='fill-transparent stroke-red-500' />
            ),
            onClick: () => {
              const mockEvent = {
                preventDefault: () => {},
                stopPropagation: () => {},
              } as React.MouseEvent;
              handleToggleFavorite(mockEvent);
            },
            color: currentFavorited
              ? ('danger' as const)
              : ('default' as const),
          });
        }
      }

      // 删除播放记录操作
      if (
        config.showCheckCircle &&
        from === 'playrecord' &&
        actualSource &&
        actualId
      ) {
        actions.push({
          id: 'delete',
          label: '删除记录',
          icon: <Trash2 size={20} />,
          onClick: () => {
            const mockEvent = {
              preventDefault: () => {},
              stopPropagation: () => {},
            } as React.MouseEvent;
            handleDeleteRecord(mockEvent);
          },
          color: 'danger' as const,
        });
      }

      // 豆瓣链接操作
      if (config.showDoubanLink && actualDoubanId && actualDoubanId !== 0) {
        actions.push({
          id: 'douban',
          label: isBangumi ? 'Bangumi 详情' : '豆瓣详情',
          icon: <Link size={20} />,
          onClick: () => {
            const url = isBangumi
              ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
              : `https://movie.douban.com/subject/${actualDoubanId.toString()}`;
            window.open(url, '_blank', 'noopener,noreferrer');
          },
          color: 'default' as const,
        });
      }

      return actions;
    }, [
      config,
      from,
      actualSource,
      actualId,
      visibleFavorited,
      searchFavorited,
      actualDoubanId,
      isBangumi,
      isAggregate,
      dynamicSourceNames,
      handleClick,
      handleToggleFavorite,
      handleDeleteRecord,
    ]);

    useEffect(() => {
      if (!showMobileActions) {
        hideActionSheet(interactionId);
        return;
      }

      showActionSheet(
        interactionId,
        {
          title: actualTitle,
          poster: actualPoster,
          actions: buildMobileActions(),
          sources:
            isAggregate && dynamicSourceNames
              ? Array.from(new Set(dynamicSourceNames))
              : undefined,
          isAggregate,
          sourceName: source_name,
          currentEpisode,
          totalEpisodes: actualEpisodes,
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
      actualEpisodes,
      actualPoster,
      actualTitle,
      buildMobileActions,
      closeActionSheet,
      currentEpisode,
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
          className={`group relative w-full cursor-pointer rounded-lg bg-transparent transition-[transform,opacity] duration-300 ease-in-out hover:z-[500] hover:scale-[1.025] active:scale-[0.97] active:opacity-80 ${from === 'search' ? 'animate-fade-in' : ''}`}
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

            // 右键弹出操作菜单
            const rect = e.currentTarget.getBoundingClientRect();
            setActionSheetAnchorRect({
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
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
            priority={priority}
            origin={origin}
            from={from}
            config={config}
            year={actualYear}
            rate={rate}
            episodes={actualEpisodes}
            currentEpisode={currentEpisode}
            doubanId={actualDoubanId}
            isBangumi={isBangumi}
            isAggregate={isAggregate}
            sourceNames={dynamicSourceNames}
            progress={progress}
            visibleFavorited={visibleFavorited}
            onDeleteRecord={handleDeleteRecord}
            onToggleFavorite={handleToggleFavorite}
          />

          <VideoCardTitle
            title={actualTitle}
            sourceName={source_name}
            origin={origin}
            config={config}
          />
        </div>
      </>
    );
  },
);

export default memo(VideoCard, areVideoCardPropsEqual);
