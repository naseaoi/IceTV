'use client';

import { Link as LinkIcon, PlayCircleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { memo, useCallback, useEffect, useId, useRef } from 'react';

import { useOptionalCardInteractionManager } from '@/components/CardInteractionProvider';
import CoverImage from '@/components/CoverImage';
import { useLongPress } from '@/hooks/useLongPress';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import {
  canUseHoverPrefetch,
  canUseNetworkPrefetch,
  findLocalPlaybackTargetByTitle,
  PREFETCH_INTENT_DELAY_MS,
  transferWarmedSearchToAggregateGroup,
  warmupSearchForTitle,
} from '@/lib/video-prefetch';

const noSelectStyle = {
  WebkitUserSelect: 'none',
  userSelect: 'none',
  WebkitTouchCallout: 'none',
} as React.CSSProperties;

const preventContextMenu = (event: React.MouseEvent) => {
  event.preventDefault();
  return false;
};

interface PosterCardProps {
  title: string;
  poster: string;
  doubanId?: number;
  rate?: string;
  year?: string;
  type?: string;
  isBangumi?: boolean;
  priority?: boolean;
}

function buildExternalUrl(doubanId?: number, isBangumi = false) {
  if (!doubanId || doubanId === 0) {
    return null;
  }

  return isBangumi
    ? `https://bgm.tv/subject/${doubanId.toString()}`
    : `https://movie.douban.com/subject/${doubanId.toString()}`;
}

function arePosterCardPropsEqual(
  previous: Readonly<PosterCardProps>,
  next: Readonly<PosterCardProps>,
): boolean {
  return (
    previous.title === next.title &&
    previous.poster === next.poster &&
    previous.doubanId === next.doubanId &&
    previous.rate === next.rate &&
    previous.year === next.year &&
    previous.type === next.type &&
    previous.isBangumi === next.isBangumi &&
    previous.priority === next.priority
  );
}

function PosterCard({
  title,
  poster,
  doubanId,
  rate,
  year,
  type = '',
  isBangumi = false,
  priority = false,
}: PosterCardProps) {
  const router = useRouter();
  const interactionId = useId();
  const prefetchTimerRef = useRef<number | null>(null);
  const interactionManager = useOptionalCardInteractionManager();
  const showActionSheet = interactionManager?.showActionSheet;
  const hideActionSheet = interactionManager?.hideActionSheet;
  const externalUrl = buildExternalUrl(doubanId, isBangumi);
  const externalLinkLabel = isBangumi
    ? `打开${title}的 Bangumi 页面`
    : `打开${title}的豆瓣页面`;

  const buildPlayUrl = useCallback(() => {
    const localTarget = findLocalPlaybackTargetByTitle(title, year);
    if (localTarget) {
      return `/play?source=${encodeURIComponent(localTarget.source)}&id=${encodeURIComponent(
        localTarget.id,
      )}&title=${encodeURIComponent(title.trim())}${
        year ? `&year=${year}` : ''
      }${type ? `&stype=${type}` : ''}`;
    }

    return `/play?title=${encodeURIComponent(title.trim())}${
      year ? `&year=${year}` : ''
    }${type ? `&stype=${type}` : ''}`;
  }, [title, type, year]);

  const handlePlay = useCallback(() => {
    const playUrl = withReturnTo(buildPlayUrl(), getCurrentNavigationPath());
    const authInfo = getAuthInfoFromBrowserCookie();
    if (authInfo?.username) {
      const hasLocalTarget = !!findLocalPlaybackTargetByTitle(title, year);
      if (canUseNetworkPrefetch() && !hasLocalTarget) {
        transferWarmedSearchToAggregateGroup(title);
        warmupSearchForTitle(title);
      }
    }
    router.push(playUrl);
  }, [buildPlayUrl, router, title, year]);

  // hover / focus 预热：提前触发标题聚合搜索并预取播放页路由
  const handlePrefetch = useCallback(() => {
    if (!canUseHoverPrefetch()) return;

    router.prefetch('/play');
    if (prefetchTimerRef.current) {
      window.clearTimeout(prefetchTimerRef.current);
    }
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = null;
      warmupSearchForTitle(title);
    }, PREFETCH_INTENT_DELAY_MS);
  }, [router, title]);

  const cancelPrefetch = useCallback(() => {
    if (!prefetchTimerRef.current) return;
    window.clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = null;
  }, []);

  useEffect(() => cancelPrefetch, [cancelPrefetch]);

  const handleExternalOpen = useCallback(() => {
    if (!externalUrl) {
      return;
    }

    window.open(externalUrl, '_blank', 'noopener,noreferrer');
  }, [externalUrl]);

  const openActionSheet = useCallback(
    (anchorRect?: {
      top: number;
      left: number;
      width: number;
      height: number;
    }) => {
      if (!showActionSheet) {
        return;
      }

      showActionSheet(interactionId, {
        title,
        poster,
        actions: [
          {
            id: 'play',
            label: '播放',
            icon: <PlayCircleIcon size={20} />,
            onClick: () => {
              hideActionSheet?.(interactionId);
              handlePlay();
            },
            color: 'primary' as const,
          },
          ...(externalUrl
            ? [
                {
                  id: 'douban',
                  label: isBangumi ? 'Bangumi 详情' : '豆瓣详情',
                  icon: <LinkIcon size={20} />,
                  onClick: () => {
                    hideActionSheet?.(interactionId);
                    handleExternalOpen();
                  },
                  color: 'default' as const,
                },
              ]
            : []),
        ],
        anchorRect: anchorRect || null,
      });
    },
    [
      externalUrl,
      handleExternalOpen,
      handlePlay,
      hideActionSheet,
      interactionId,
      isBangumi,
      poster,
      showActionSheet,
      title,
    ],
  );

  const longPressProps = useLongPress({
    onLongPress: () => openActionSheet(),
    onClick: handlePlay,
    longPressDelay: 500,
  });

  useEffect(() => {
    return () => {
      hideActionSheet?.(interactionId);
    };
  }, [hideActionSheet, interactionId]);

  return (
    <div
      className='group relative w-full cursor-pointer rounded-lg bg-transparent transition-[transform,opacity] duration-300 ease-in-out hover:z-[500] hover:scale-[1.025] active:scale-[0.97] active:opacity-80'
      onClick={handlePlay}
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
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();

        const rect = event.currentTarget.getBoundingClientRect();
        openActionSheet({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });

        return false;
      }}
      onDragStart={(event) => {
        event.preventDefault();
        return false;
      }}
    >
      <div
        className='poster-rounded-clip relative aspect-[2/3] overflow-hidden rounded-lg'
        style={noSelectStyle}
        onContextMenu={preventContextMenu}
      >
        <CoverImage src={poster} alt={title} priority={priority} />

        <div
          className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        />

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

        {rate && (
          <div
            className='absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-pink-700 text-xs font-bold text-white shadow-md transition-all duration-300 ease-out group-hover:scale-110'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            {rate}
          </div>
        )}

        {externalUrl && (
          <a
            href={externalUrl}
            target='_blank'
            rel='noopener noreferrer'
            onClick={(event) => event.stopPropagation()}
            className='absolute left-2 top-2 -translate-x-2 opacity-0 transition-all delay-100 duration-300 ease-in-out sm:group-hover:translate-x-0 sm:group-hover:opacity-100'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
            aria-label={externalLinkLabel}
            title={externalLinkLabel}
          >
            <div
              className='flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white shadow-md transition-all duration-300 ease-out hover:scale-[1.1] hover:bg-green-600'
              style={noSelectStyle}
              onContextMenu={preventContextMenu}
            >
              <LinkIcon
                size={16}
                aria-hidden='true'
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
      </div>

      <div
        className='mt-2 h-5 text-center'
        style={noSelectStyle}
        onContextMenu={preventContextMenu}
      >
        <div className='relative' style={noSelectStyle}>
          <span
            className='peer block truncate text-sm font-semibold text-gray-900 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:text-gray-100 dark:group-hover:text-green-400'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            {title}
          </span>
          <div
            className='pointer-events-none invisible absolute bottom-full left-1/2 mb-2 -translate-x-1/2 transform whitespace-nowrap rounded-md bg-gray-800 px-3 py-1 text-xs text-white opacity-0 shadow-lg transition-all delay-100 duration-200 ease-out peer-hover:visible peer-hover:opacity-100'
            style={noSelectStyle}
            onContextMenu={preventContextMenu}
          >
            {title}
            <div
              className='absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 transform border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'
              style={noSelectStyle}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(PosterCard, arePosterCardPropsEqual);
