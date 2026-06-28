'use client';

import Image from 'next/image';
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  isCoverImageCached,
  markCoverImagesLoaded,
  subscribeCoverImageLoaded,
} from '@/lib/cover-image-cache';
import { imageScheduler } from '@/lib/image-scheduler';
import { processImageUrl } from '@/lib/utils';

import NoImageCover from '@/components/NoImageCover';

const PLACEHOLDER_COLORS = [
  '#94a3b8',
  '#7c83fd',
  '#60a5fa',
  '#34d399',
  '#f59e0b',
  '#f472b6',
  '#818cf8',
  '#22c55e',
];
const DEFAULT_DOUBAN_IMAGE_CDN_HOST = 'img.doubanio.cmliussss.net';
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

function pickPlaceholderColor(seed: string): string {
  if (!seed) {
    return PLACEHOLDER_COLORS[0];
  }

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }

  return PLACEHOLDER_COLORS[hash % PLACEHOLDER_COLORS.length];
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(148, 163, 184, ${alpha})`;
  }

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildBlurDataURL(color: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${withAlpha(color, 0.92)}" />
          <stop offset="55%" stop-color="${withAlpha(color, 0.58)}" />
          <stop offset="100%" stop-color="${withAlpha(color, 0.3)}" />
        </linearGradient>
      </defs>
      <rect width="32" height="48" fill="url(#g)" />
      <circle cx="7" cy="10" r="10" fill="${withAlpha('#ffffff', 0.18)}" />
      <circle cx="28" cy="38" r="13" fill="${withAlpha('#000000', 0.08)}" />
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function needsImageUnoptimized(url: string): boolean {
  if (!url || url.startsWith('/') || url.startsWith('data:')) {
    return false;
  }

  return true;
}

function toDefaultDoubanImageCdn(url: string): string {
  try {
    const parsed = new URL(url);
    if (/^img\d+\.doubanio\.com$/.test(parsed.hostname)) {
      parsed.hostname = DEFAULT_DOUBAN_IMAGE_CDN_HOST;
      return parsed.toString();
    }
  } catch {}

  return url;
}

/** 最大重试次数（首次加载不算，失败后最多再试 MAX_RETRIES 次） */
const MAX_RETRIES = 2;
/** 每次重试间隔 ms */
const RETRY_DELAY = 1200;
/** 进入视口前的预加载距离，提前约一屏开始加载，滚动时封面无感衔接 */
const VIEWPORT_PRELOAD_MARGIN = '600px';

// ================================================================
// CoverImage 组件
// ================================================================

interface CoverImageProps {
  src: string;
  alt: string;
  /** 首屏图片预加载，提高 LCP 表现 */
  priority?: boolean;
  /** 传给 Next.js Image 的 sizes，默认 '(max-width: 640px) 96px, 180px' */
  sizes?: string;
  quality?: number;
  /** object-fit 模式，默认 'cover' */
  fit?: 'cover' | 'contain';
  /** 骨架屏宽高比 class，默认 'aspect-[2/3]' */
  aspectRatio?: string;
  /** 可选占位主色，未传时根据 src 稳定生成 */
  placeholderColor?: string;
  /** 加载失败后自动重试（最多 2 次），默认 true */
  enableRetry?: boolean;
  /** 无封面兜底文案 */
  fallbackLabel?: string;
}

/**
 * 统一封面图片组件：骨架屏 → 加载 → 重试(最多2次) → 兜底。
 * 内置内存缓存 + 跨实例同步（模态框加载成功后卡片立即显示）。
 * 外层容器需要 `position: relative` + 固定宽高。
 */
const CoverImage: React.FC<CoverImageProps> = memo(function CoverImage({
  src,
  alt,
  priority = false,
  sizes = '(max-width: 640px) 96px, 180px',
  quality = 72,
  fit = 'cover',
  placeholderColor,
  enableRetry = true,
  fallbackLabel = '无封面',
}) {
  const isEmpty = !src || src.trim() === '';
  const [retryKey, setRetryKey] = useState(0);
  const [useDefaultDoubanCdn, setUseDefaultDoubanCdn] = useState(false);
  const retryCountRef = useRef(0);
  const releaseSlotRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const processed = useMemo(
    () =>
      isEmpty
        ? ''
        : useDefaultDoubanCdn
          ? toDefaultDoubanImageCdn(processImageUrl(src))
          : processImageUrl(src),
    [src, isEmpty, useDefaultDoubanCdn],
  );

  const needsUnoptimized = useMemo(() => {
    if (!processed) return false;
    return needsImageUnoptimized(processed);
  }, [processed]);

  const displaySrc = useMemo(
    () =>
      retryKey > 0
        ? `${processed}${processed.includes('?') ? '&' : '?'}retry=${retryKey}`
        : processed,
    [processed, retryKey],
  );

  const cacheKeys = useMemo(
    () => Array.from(new Set([src, processed].filter(Boolean))),
    [processed, src],
  );

  const cached =
    !isEmpty && isCoverImageCached(cacheKeys, { includePersistent: false });
  // 可见性门控：只有进入/接近可视区域才允许 acquire slot。
  // 首屏 priority 图片直接放行。
  const [isNearViewport, setIsNearViewport] = useState(cached || priority);
  const [loaded, setLoaded] = useState(cached);
  const [hasError, setHasError] = useState(false);
  // 并发调度：是否已获得加载 slot（缓存命中则直接跳过排队）
  const [slotGranted, setSlotGranted] = useState(cached);

  const resolvedPlaceholderColor = useMemo(() => {
    if (placeholderColor && /^#[0-9a-fA-F]{6}$/.test(placeholderColor)) {
      return placeholderColor;
    }
    return pickPlaceholderColor(src || alt);
  }, [alt, placeholderColor, src]);

  const blurDataURL = useMemo(
    () => buildBlurDataURL(resolvedPlaceholderColor),
    [resolvedPlaceholderColor],
  );

  const loadingBackdropStyle = useMemo(
    () =>
      ({
        background: `linear-gradient(135deg, ${withAlpha(resolvedPlaceholderColor, 0.28)} 0%, ${withAlpha(resolvedPlaceholderColor, 0.14)} 100%)`,
      }) as React.CSSProperties,
    [resolvedPlaceholderColor],
  );

  // src 变化时重置所有状态（包括释放旧 slot）
  useEffect(() => {
    retryCountRef.current = 0;
    setRetryKey(0);
    setUseDefaultDoubanCdn(false);
    setHasError(false);
    const isCached = isCoverImageCached([src]);
    setLoaded(isCached);
    setSlotGranted(isCached);
    setIsNearViewport(isCached || priority);

    // 释放旧 slot
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [priority, src]);

  useIsomorphicLayoutEffect(() => {
    if (isEmpty || loaded || hasError) return;
    if (!isCoverImageCached(cacheKeys)) return;

    setLoaded(true);
    setSlotGranted(true);
    setIsNearViewport(true);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [cacheKeys, hasError, isEmpty, loaded]);

  // 可见性检测：进入视口附近一小段距离时就开始预加载
  // 首页横向滚动行控制不可见卡片排队
  useEffect(() => {
    if (isEmpty || isNearViewport || priority) return;
    const el = containerRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true);
          io.disconnect();
        }
      },
      { rootMargin: VIEWPORT_PRELOAD_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isEmpty, isNearViewport, priority]);

  // 请求并发 slot（可见 & 未缓存 & 未出错 & 尚未获得 slot 时排队）
  // 注意：不把 slotGranted 放在依赖中。
  const needsSlot = !isEmpty && isNearViewport && !slotGranted && !hasError;
  const needsSlotRef = useRef(needsSlot);
  needsSlotRef.current = needsSlot;

  useEffect(() => {
    if (!needsSlotRef.current) return;

    const release = imageScheduler.acquire(() => {
      setSlotGranted(true);
    });
    releaseSlotRef.current = release;

    return () => {
      release();
      releaseSlotRef.current = null;
    };
  }, [src, isNearViewport]);

  // 跨实例同步：其他 CoverImage 实例加载了同一 src 时，立即标记已加载。
  // 典型场景：模态框加载成功 → 卡片立即显示，无需等待自身请求完成。
  useEffect(() => {
    if (loaded || hasError || isEmpty) return;

    return subscribeCoverImageLoaded(cacheKeys, () => {
      setLoaded(true);
      setSlotGranted(true);
      setIsNearViewport(true);
      setRetryKey(0);
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
    });
  }, [cacheKeys, loaded, hasError, isEmpty]);

  const showFallback = isEmpty || hasError;

  const handleLoad = useCallback(() => {
    setLoaded(true);
    markCoverImagesLoaded(cacheKeys);
    // 加载完成 → 释放 slot
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [cacheKeys]);

  useEffect(() => {
    if (!slotGranted || loaded || hasError) return;
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      handleLoad();
    }
  }, [displaySrc, handleLoad, hasError, loaded, slotGranted]);

  const handleError = useCallback(() => {
    const defaultCdnUrl = toDefaultDoubanImageCdn(processed);
    if (!useDefaultDoubanCdn && defaultCdnUrl !== processed) {
      retryCountRef.current = 0;
      setUseDefaultDoubanCdn(true);
      setLoaded(false);
      return;
    }

    if (!enableRetry || retryCountRef.current >= MAX_RETRIES) {
      setHasError(true);
      setLoaded(true);
      // 最终失败 → 释放 slot
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
      return;
    }
    // 重试期间保持加载态
    // 不释放 slot——重试仍在使用同一个 slot
    setLoaded(false);
    retryCountRef.current += 1;
    setTimeout(() => {
      setRetryKey(Date.now());
    }, RETRY_DELAY);
  }, [enableRetry, processed, useDefaultDoubanCdn]);

  if (showFallback) {
    return (
      <NoImageCover label={fallbackLabel} iconSize={34} iconStrokeWidth={1.5} />
    );
  }

  return (
    <div ref={containerRef} className='absolute inset-0'>
      {!loaded && (
        <div
          className='pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg'
          style={loadingBackdropStyle}
        >
          <div className='absolute inset-0 animate-pulse rounded-lg bg-white/10 dark:bg-white/5' />
          <div className='relative h-5 w-5 animate-spin rounded-full border-2 border-white/35 border-t-white/80 dark:border-white/20 dark:border-t-white/60' />
        </div>
      )}
      {slotGranted && (
        <Image
          key={retryKey}
          ref={imageRef}
          src={displaySrc}
          alt={alt}
          fill
          sizes={sizes}
          quality={needsUnoptimized ? undefined : quality}
          preload={priority}
          unoptimized={needsUnoptimized}
          placeholder='blur'
          blurDataURL={blurDataURL}
          className={`${fit === 'contain' ? 'object-contain' : 'object-cover'} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          referrerPolicy='no-referrer'
          loading={priority ? 'eager' : 'lazy'}
          onLoad={handleLoad}
          onError={handleError}
          style={
            {
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
              pointerEvents: 'none',
            } as React.CSSProperties
          }
          onContextMenu={(e) => {
            e.preventDefault();
            return false;
          }}
          onDragStart={(e) => {
            e.preventDefault();
            return false;
          }}
        />
      )}
    </div>
  );
});

export default CoverImage;
