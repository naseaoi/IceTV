import {
  ExternalLink,
  Heart,
  Link,
  PlayCircleIcon,
  Radio,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, {
  forwardRef,
  useId,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  saveFavorite,
} from '@/lib/db.client';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { SearchResult } from '@/lib/types';
import { warmupForPlayback } from '@/lib/video-prefetch';
import { useLongPress } from '@/hooks/useLongPress';
import { savePlayIntent } from '@/features/play/lib/playIntent';

import {
  useCardInteractionManager,
  useFavoriteStatus,
} from '@/components/CardInteractionProvider';
import CoverImage from '@/components/CoverImage';

/** 禁用文本选中和长按弹出的内联样式 */
const noSelectStyle = {
  WebkitUserSelect: 'none',
  userSelect: 'none',
  WebkitTouchCallout: 'none',
} as React.CSSProperties;

const PREFETCH_INTENT_DELAY_MS = 180;

function canUseHoverPrefetch(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return false;
  }

  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData) return false;
  return !['slow-2g', '2g'].includes(connection?.effectiveType || '');
}

/** 阻止默认右键菜单 */
const preventContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  return false;
};

export interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  priority?: boolean;
  episodes?: number;
  source_name?: string;
  source_names?: string[];
  progress?: number;
  resumeTime?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: number;
  onDelete?: () => void;
  rate?: string;
  type?: string;
  isBangumi?: boolean;
  isAggregate?: boolean;
  origin?: 'vod' | 'live';
  aggregateGroup?: SearchResult[];
}

export type VideoCardHandle = {
  setEpisodes: (episodes?: number) => void;
  setSourceNames: (names?: string[]) => void;
  setDoubanId: (id?: number) => void;
};

function isSameStringArray(prev?: string[], next?: string[]): boolean {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return !prev && !next;
  }
  if (prev.length !== next.length) {
    return false;
  }

  return prev.every((item, index) => item === next[index]);
}

function isSameAggregateGroup(
  prev?: SearchResult[],
  next?: SearchResult[],
): boolean {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return !prev && !next;
  }
  if (prev.length !== next.length) {
    return false;
  }

  return prev.every((item, index) => {
    const nextItem = next[index];
    return (
      item.id === nextItem.id &&
      item.source === nextItem.source &&
      item.title === nextItem.title &&
      item.poster === nextItem.poster &&
      item.year === nextItem.year &&
      item.source_name === nextItem.source_name &&
      item.douban_id === nextItem.douban_id &&
      item.episodes.length === nextItem.episodes.length &&
      item.episodes_titles.length === nextItem.episodes_titles.length
    );
  });
}

function areVideoCardPropsEqual(
  prev: Readonly<VideoCardProps>,
  next: Readonly<VideoCardProps>,
): boolean {
  return (
    prev.id === next.id &&
    prev.source === next.source &&
    prev.title === next.title &&
    prev.query === next.query &&
    prev.poster === next.poster &&
    prev.priority === next.priority &&
    prev.episodes === next.episodes &&
    prev.source_name === next.source_name &&
    isSameStringArray(prev.source_names, next.source_names) &&
    prev.progress === next.progress &&
    prev.resumeTime === next.resumeTime &&
    prev.year === next.year &&
    prev.from === next.from &&
    prev.currentEpisode === next.currentEpisode &&
    prev.douban_id === next.douban_id &&
    prev.rate === next.rate &&
    prev.type === next.type &&
    prev.isBangumi === next.isBangumi &&
    prev.isAggregate === next.isAggregate &&
    prev.origin === next.origin &&
    isSameAggregateGroup(prev.aggregateGroup, next.aggregateGroup)
  );
}

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
    const favorited = useFavoriteStatus(
      actualSource,
      actualId,
      from !== 'douban' && from !== 'search' && !!actualSource && !!actualId,
    );

    const handleToggleFavorite = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (from === 'douban' || !actualSource || !actualId) return;

        try {
          const currentFavorited =
            from === 'search' ? searchFavorited : favorited;

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
        favorited,
        searchFavorited,
        showConfirm,
        interactionId,
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
    ]);

    // hover / focus 预热：提前加载 detail 与播放器模块，进入播放页几乎无等待
    // 仅对拥有 source+id 的普通卡片生效（聚合卡、豆瓣卡跳转路径不同，跳过）
    const handlePrefetch = useCallback(() => {
      if (origin === 'live') return;
      if (from === 'douban') return;
      if (isAggregate) return;
      if (!canUseHoverPrefetch()) return;

      if (prefetchTimerRef.current) {
        window.clearTimeout(prefetchTimerRef.current);
      }
      prefetchTimerRef.current = window.setTimeout(() => {
        prefetchTimerRef.current = null;
        warmupForPlayback(actualSource, actualId);
      }, PREFETCH_INTENT_DELAY_MS);
    }, [actualId, actualSource, from, isAggregate, origin]);

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
        actualSource &&
        actualId &&
        searchFavorited === null
      ) {
        try {
          await ensureFavoritesLoaded();
          setSearchFavorited(
            getFavoriteStatus(generateStorageKey(actualSource, actualId)),
          );
        } catch (err) {
          setSearchFavorited(false);
        }
      }
    }, [
      from,
      isAggregate,
      actualSource,
      actualId,
      searchFavorited,
      ensureFavoritesLoaded,
      getFavoriteStatus,
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

        // 异步检查收藏状态，不阻塞菜单显示
        if (
          from === 'search' &&
          !isAggregate &&
          actualSource &&
          actualId &&
          searchFavorited === null
        ) {
          checkSearchFavoriteStatus();
        }
      }
    }, [
      showMobileActions,
      from,
      isAggregate,
      actualSource,
      actualId,
      searchFavorited,
      checkSearchFavoriteStatus,
    ]);

    // 长按手势hook
    const longPressProps = useLongPress({
      onLongPress: handleLongPress,
      onClick: handleClick, // 保持点击播放功能
      longPressDelay: 500,
    });

    const config = useMemo(() => {
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
          from === 'search' ? searchFavorited : favorited;

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
      favorited,
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
          className='group relative w-full cursor-pointer rounded-lg bg-transparent transition-[transform,opacity] duration-300 ease-in-out hover:z-[500] hover:scale-[1.025] active:scale-[0.97] active:opacity-80'
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

            // 异步检查收藏状态，不阻塞菜单显示
            if (
              from === 'search' &&
              !isAggregate &&
              actualSource &&
              actualId &&
              searchFavorited === null
            ) {
              checkSearchFavoriteStatus();
            }

            return false;
          }}
          onDragStart={(e) => {
            // 阻止拖拽
            e.preventDefault();
            return false;
          }}
        >
          {/* 海报容器 */}
          <div
            className={`relative aspect-[2/3] overflow-hidden rounded-lg ${
              origin === 'live'
                ? 'ring-1 ring-gray-300/80 dark:ring-gray-600/80'
                : ''
            }`}
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            {/* 封面 */}
            <CoverImage
              src={actualPoster}
              alt={actualTitle}
              priority={priority}
              fit={origin === 'live' ? 'contain' : 'cover'}
            />

            {/* 悬浮遮罩 */}
            <div
              className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100'
              style={noSelectStyle}
              onContextMenu={preventContextMenu}
            />

            {/* 播放按钮 */}
            {config.showPlayButton && (
              <div
                data-button='true'
                className='absolute inset-0 flex items-center justify-center opacity-0 transition-all delay-75 duration-300 ease-in-out group-hover:scale-100 group-hover:opacity-100'
                style={noSelectStyle}
                onContextMenu={preventContextMenu}
              >
                <PlayCircleIcon
                  size={50}
                  strokeWidth={0.8}
                  className='fill-transparent text-white transition-all duration-300 ease-out hover:scale-[1.1] hover:fill-green-500'
                  style={noSelectStyle}
                  onContextMenu={preventContextMenu}
                />
              </div>
            )}

            {/* 操作按钮 */}
            {(config.showHeart || config.showCheckCircle) && (
              <div
                data-button='true'
                className='absolute bottom-3 right-3 flex translate-y-2 gap-3 opacity-0 transition-all duration-300 ease-in-out sm:group-hover:translate-y-0 sm:group-hover:opacity-100'
                style={noSelectStyle}
                onContextMenu={preventContextMenu}
              >
                {config.showCheckCircle && (
                  <Trash2
                    onClick={handleDeleteRecord}
                    size={20}
                    className='text-white transition-all duration-300 ease-out hover:scale-[1.1] hover:stroke-red-500'
                    style={noSelectStyle}
                    onContextMenu={preventContextMenu}
                  />
                )}
                {config.showHeart && from !== 'search' && (
                  <Heart
                    onClick={handleToggleFavorite}
                    size={20}
                    className={`transition-all duration-300 ease-out ${
                      favorited
                        ? 'fill-red-600 stroke-red-600'
                        : 'fill-transparent stroke-white hover:stroke-red-400'
                    } hover:scale-[1.1]`}
                    style={noSelectStyle}
                    onContextMenu={preventContextMenu}
                  />
                )}
              </div>
            )}

            {/* 年份徽章 */}
            {config.showYear &&
              actualYear &&
              actualYear !== 'unknown' &&
              actualYear.trim() !== '' && (
                <div
                  className='absolute left-2 top-2 rounded bg-black/50 px-2 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-sm transition-all duration-300 ease-out group-hover:opacity-90'
                  style={noSelectStyle}
                  onContextMenu={preventContextMenu}
                >
                  {actualYear}
                </div>
              )}

            {/* 徽章 */}
            {config.showRating && rate && (
              <div
                className='absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-pink-500 text-xs font-bold text-white shadow-md transition-all duration-300 ease-out group-hover:scale-110'
                style={noSelectStyle}
                onContextMenu={preventContextMenu}
              >
                {rate}
              </div>
            )}

            {actualEpisodes && actualEpisodes > 1 && (
              <div
                className='absolute right-2 top-2 rounded-md bg-green-500 px-2 py-1 text-xs font-semibold text-white shadow-md transition-all duration-300 ease-out group-hover:scale-110'
                style={noSelectStyle}
                onContextMenu={preventContextMenu}
              >
                {currentEpisode
                  ? `${currentEpisode}/${actualEpisodes}`
                  : actualEpisodes}
              </div>
            )}

            {/* 豆瓣链接 */}
            {config.showDoubanLink &&
              actualDoubanId &&
              actualDoubanId !== 0 && (
                <a
                  href={
                    isBangumi
                      ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
                      : `https://movie.douban.com/subject/${actualDoubanId.toString()}`
                  }
                  target='_blank'
                  rel='noopener noreferrer'
                  onClick={(e) => e.stopPropagation()}
                  className='absolute left-2 top-2 -translate-x-2 opacity-0 transition-all delay-100 duration-300 ease-in-out sm:group-hover:translate-x-0 sm:group-hover:opacity-100'
                  style={noSelectStyle}
                  onContextMenu={preventContextMenu}
                >
                  <div
                    className='flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white shadow-md transition-all duration-300 ease-out hover:scale-[1.1] hover:bg-green-600'
                    style={noSelectStyle}
                    onContextMenu={preventContextMenu}
                  >
                    <Link
                      size={16}
                      style={
                        {
                          ...noSelectStyle,
                          pointerEvents: 'none',
                        } as React.CSSProperties
                      }
                    />
                  </div>
                </a>
              )}

            {/* 聚合播放源指示器 */}
            {isAggregate &&
              dynamicSourceNames &&
              dynamicSourceNames.length > 0 &&
              (() => {
                const uniqueSources = Array.from(new Set(dynamicSourceNames));
                const sourceCount = uniqueSources.length;

                return (
                  <div
                    className='absolute bottom-2 right-2 opacity-0 transition-all delay-75 duration-300 ease-in-out sm:group-hover:opacity-100'
                    style={noSelectStyle}
                    onContextMenu={preventContextMenu}
                  >
                    <div
                      className='group/sources relative'
                      style={noSelectStyle}
                    >
                      <div
                        className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-white shadow-md transition-all duration-300 ease-out hover:scale-[1.1] hover:bg-gray-600 sm:h-7 sm:w-7'
                        style={noSelectStyle}
                        onContextMenu={preventContextMenu}
                      >
                        {sourceCount}
                      </div>

                      {/* 播放源详情悬浮框 */}
                      {(() => {
                        // 优先显示的播放源（常见的主流平台）
                        const prioritySources = [
                          '爱奇艺',
                          '腾讯视频',
                          '优酷',
                          '芒果TV',
                          '哔哩哔哩',
                          'Netflix',
                          'Disney+',
                        ];

                        // 按优先级排序播放源
                        const sortedSources = uniqueSources.sort((a, b) => {
                          const aIndex = prioritySources.indexOf(a);
                          const bIndex = prioritySources.indexOf(b);
                          if (aIndex !== -1 && bIndex !== -1)
                            return aIndex - bIndex;
                          if (aIndex !== -1) return -1;
                          if (bIndex !== -1) return 1;
                          return a.localeCompare(b);
                        });

                        const maxDisplayCount = 6; // 最多显示6个
                        const displaySources = sortedSources.slice(
                          0,
                          maxDisplayCount,
                        );
                        const hasMore = sortedSources.length > maxDisplayCount;
                        const remainingCount =
                          sortedSources.length - maxDisplayCount;

                        return (
                          <div
                            className='pointer-events-none invisible absolute bottom-full right-0 z-50 mb-2 -translate-x-0 opacity-0 transition-all delay-100 duration-200 ease-out group-hover/sources:visible group-hover/sources:opacity-100 sm:right-0 sm:translate-x-0'
                            style={noSelectStyle}
                            onContextMenu={preventContextMenu}
                          >
                            <div
                              className='w-[7em] overflow-hidden rounded-lg border border-white/10 bg-gray-800/90 p-1.5 text-xs text-white shadow-xl backdrop-blur-sm sm:w-[7.5em] sm:p-2 sm:text-xs'
                              style={noSelectStyle}
                              onContextMenu={preventContextMenu}
                            >
                              {/* 单列布局 */}
                              <div className='space-y-0.5 sm:space-y-1'>
                                {displaySources.map((sourceName, index) => (
                                  <div
                                    key={index}
                                    className='flex min-w-0 items-center gap-1 sm:gap-1.5'
                                  >
                                    <div className='h-0.5 w-0.5 flex-shrink-0 rounded-full bg-blue-400 sm:h-1 sm:w-1'></div>
                                    <span
                                      className='block w-[4em] shrink-0 truncate text-[10px] leading-tight sm:text-xs'
                                      title={sourceName}
                                    >
                                      {sourceName}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              {/* 显示更多提示 */}
                              {hasMore && (
                                <div className='mt-1 border-t border-gray-700/50 pt-1 sm:mt-2 sm:pt-1.5'>
                                  <div className='flex items-center justify-center text-gray-400'>
                                    <span className='text-[10px] font-medium sm:text-xs'>
                                      +{remainingCount} 播放源
                                    </span>
                                  </div>
                                </div>
                              )}

                              {/* 小箭头 */}
                              <div className='absolute right-2 top-full h-0 w-0 border-l-[4px] border-r-[4px] border-t-[4px] border-transparent border-t-gray-800/90 sm:right-3 sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px]'></div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}

            {/* 进度条：覆盖在封面底部 */}
            {config.showProgress && progress !== undefined && progress > 0 && (
              <div
                className='absolute bottom-0 left-0 right-0 h-1 bg-black/30'
                style={noSelectStyle}
                onContextMenu={preventContextMenu}
              >
                <div
                  className='h-full bg-green-500 transition-all duration-500 ease-out'
                  style={
                    {
                      width: `${progress}%`,
                      ...noSelectStyle,
                    } as React.CSSProperties
                  }
                  onContextMenu={preventContextMenu}
                />
              </div>
            )}
          </div>

          {/* 标题与来源：保留在文档流中，让卡片高度稳定参与布局，避免首页区块间距被压缩。 */}
          <div
            className='mt-2 text-center'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            <div className='relative' style={noSelectStyle}>
              <span
                className='peer block truncate text-sm font-semibold text-gray-900 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:text-gray-100 dark:group-hover:text-green-400'
                style={noSelectStyle}
                onContextMenu={preventContextMenu}
              >
                {actualTitle}
              </span>
              {/* 自定义 tooltip */}
              <div
                className='pointer-events-none invisible absolute bottom-full left-1/2 mb-2 -translate-x-1/2 transform whitespace-nowrap rounded-md bg-gray-800 px-3 py-1 text-xs text-white opacity-0 shadow-lg transition-all delay-100 duration-200 ease-out peer-hover:visible peer-hover:opacity-100'
                style={noSelectStyle}
                onContextMenu={preventContextMenu}
              >
                {actualTitle}
                <div
                  className='absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 transform border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'
                  style={noSelectStyle}
                ></div>
              </div>
            </div>
            {config.showSourceName && source_name && (
              <span
                className='mt-1 block text-xs text-gray-500 dark:text-gray-400'
                style={noSelectStyle}
                onContextMenu={preventContextMenu}
              >
                <span
                  className='inline-block rounded border border-gray-500/60 px-2 py-0.5 transition-all duration-300 ease-in-out group-hover:border-green-500/60 group-hover:text-green-600 dark:border-gray-400/60 dark:group-hover:text-green-400'
                  style={noSelectStyle}
                  onContextMenu={preventContextMenu}
                >
                  {origin === 'live' && (
                    <Radio
                      size={12}
                      className='mr-1.5 inline-block text-gray-500 dark:text-gray-400'
                    />
                  )}
                  {source_name}
                </span>
              </span>
            )}
          </div>
        </div>
      </>
    );
  },
);

export default memo(VideoCard, areVideoCardPropsEqual);
