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

import { ImageLoadingBackdrop } from '@/components/ImagePlaceholder';
import NoImageCover from '@/components/NoImageCover';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import { useClientHydrated } from '@/hooks/useClientHydrated';
import {
  isCoverImageCached,
  isCoverImageFailed,
  markCoverImagesFailed,
  markCoverImagesLoaded,
  subscribeCoverImageLoaded,
} from '@/lib/cover-image-cache';
import {
  buildCoverImageVariantUrl,
  supportsCoverImageVariants,
} from '@/lib/cover-image-variants';
import {
  readDoubanFallbackRoute,
  recordDoubanRouteResult,
} from '@/lib/douban-route-memory';
import { imageScheduler } from '@/lib/image-scheduler';
import { rememberSourceCoverDirectHost } from '@/lib/source-cover-proxy';
import { getImageCandidates } from '@/lib/utils';

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

function needsImageUnoptimized(
  url: string,
  usesCoverVariants: boolean,
): boolean {
  if (
    usesCoverVariants ||
    !url ||
    url.startsWith('/') ||
    url.startsWith('data:')
  ) {
    return false;
  }

  return true;
}

// 服务端回源超时之外再留出缩放与传输时间，避免服务端仍在取图时前端先判失败
const COVER_LOAD_TIMEOUT_GRACE_MS = 5000;
// 豆瓣第三方镜像只是候选之一，等待太久不如尽快换下一个
const DOUBAN_MIRROR_TIMEOUT_MS = 8000;

// 已在浏览器缓存里的图片通常在这之前就完成解码，只有确实慢的才显示扫光与淡入，
// 避免换页回来时缓存命中的封面也闪一遍加载态
const LOADING_INDICATOR_DELAY_MS = 200;

const VIEWPORT_PRELOAD_MARGIN = '520px 180px';
const REDUCED_VIEWPORT_PRELOAD_MARGIN = '320px 96px';

interface NavigatorConnection {
  effectiveType?: string;
  saveData?: boolean;
}

function getViewportPreloadMargin() {
  const connection = (
    navigator as Navigator & { connection?: NavigatorConnection }
  ).connection;
  const shouldReducePreload =
    connection?.saveData === true ||
    connection?.effectiveType === 'slow-2g' ||
    connection?.effectiveType === '2g';

  return shouldReducePreload
    ? REDUCED_VIEWPORT_PRELOAD_MARGIN
    : VIEWPORT_PRELOAD_MARGIN;
}

interface CoverImageProps {
  src: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
  quality?: number;
  fit?: 'cover' | 'contain';
  aspectRatio?: string;
  fallbackLabel?: string;
  checkClientCacheBeforeLoad?: boolean;
  // 所有加载通道都失败（含命中失败缓存）时调用，调用方可换一张图
  onUnavailable?: () => void;
}

const CoverImage: React.FC<CoverImageProps> = memo(function CoverImage({
  src,
  alt,
  priority = false,
  sizes = '(max-width: 640px) 96px, 180px',
  quality = 72,
  fit = 'cover',
  fallbackLabel = '无封面',
  checkClientCacheBeforeLoad = false,
  onUnavailable,
}) {
  const isEmpty = !src || src.trim() === '';
  const releaseSlotRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingBackdropRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const runtimeConfig = useRuntimeConfig();
  const clientHydrated = useClientHydrated();
  // 服务端输出与首屏水合时图片还没开始加载，直接显示扫光；客户端换页挂载时先等一小段时间
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(
    () => !clientHydrated,
  );
  const shouldAnimateRevealRef = useRef(!clientHydrated);
  const resetMountedRef = useRef(false);
  // 只在水合后挂载时读取，避免首屏地址与服务端输出不一致
  const [preferredDoubanRoute] = useState(() =>
    clientHydrated ? readDoubanFallbackRoute('image') : null,
  );
  const [attempt, setAttempt] = useState(0);

  const candidates = useMemo(
    () =>
      isEmpty
        ? []
        : getImageCandidates(
            src,
            runtimeConfig.SOURCE_COVER_PROXY_MODE,
            preferredDoubanRoute,
          ),
    [isEmpty, preferredDoubanRoute, runtimeConfig.SOURCE_COVER_PROXY_MODE, src],
  );
  const candidate = candidates[Math.min(attempt, candidates.length - 1)];
  const processed = candidate?.url ?? '';

  const usesCoverVariants = supportsCoverImageVariants(processed);
  const needsUnoptimized = useMemo(
    () => needsImageUnoptimized(processed, usesCoverVariants),
    [processed, usesCoverVariants],
  );

  const cacheKeys = useMemo(
    () => Array.from(new Set([src, processed].filter(Boolean))),
    [processed, src],
  );
  const [initiallyKnownCached] = useState(
    () => clientHydrated && isCoverImageCached(cacheKeys),
  );
  const loadImmediately =
    !isEmpty &&
    (initiallyKnownCached || (priority && !checkClientCacheBeforeLoad));
  const [isNearViewport, setIsNearViewport] = useState(loadImmediately);
  const [loaded, setLoaded] = useState(false);
  const [knownCached, setKnownCached] = useState(initiallyKnownCached);
  const [hasError, setHasError] = useState(false);
  const [slotGranted, setSlotGranted] = useState(loadImmediately);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useIsomorphicLayoutEffect(() => {
    if (resetMountedRef.current) {
      shouldAnimateRevealRef.current = false;
      setShowLoadingIndicator(false);
    }
    resetMountedRef.current = true;
    setHasError(false);
    setAttempt(0);
    setLoaded(false);
    setKnownCached(false);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [runtimeConfig.SOURCE_COVER_PROXY_MODE, src]);

  useIsomorphicLayoutEffect(() => {
    if (isEmpty) return;

    const isCached = isCoverImageCached(cacheKeys);
    const isFailed = !isCached && isCoverImageFailed([processed]);
    setKnownCached(isCached);
    setLoaded(isFailed);
    setHasError(isFailed);
    setSlotGranted(!isFailed && (isCached || priority));
    setIsNearViewport(!isFailed && (isCached || priority));

    if (isCached || isFailed) {
      shouldAnimateRevealRef.current = false;
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
    }
    // 在布局阶段通知，换图时不闪出占位
    if (isFailed) onUnavailableRef.current?.();
  }, [cacheKeys, isEmpty, priority, processed]);

  // 记录只说明这张图显示过；换了尺寸规格或浏览器缓存已淘汰时仍要真正下载，
  // 挂载后未完成就回到普通加载流程，慢了照常显示扫光
  useIsomorphicLayoutEffect(() => {
    const image = imageRef.current;
    if (!knownCached || loaded || !image || image.complete) return;
    setKnownCached(false);
  }, [knownCached, loaded, processed, slotGranted]);

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
      { root: null, rootMargin: getViewportPreloadMargin() },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isEmpty, isNearViewport, priority]);

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

  useEffect(() => {
    if (loaded || hasError || isEmpty) return;

    return subscribeCoverImageLoaded(cacheKeys, () => {
      setLoaded(true);
      setSlotGranted(true);
      setIsNearViewport(true);
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
    });
  }, [cacheKeys, loaded, hasError, isEmpty]);

  const showFallback = isEmpty || hasError;
  const revealed = loaded || knownCached;

  useEffect(() => {
    if (revealed || showFallback || showLoadingIndicator) return;

    const timeoutId = setTimeout(() => {
      shouldAnimateRevealRef.current = true;
      setShowLoadingIndicator(true);
    }, LOADING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [revealed, showFallback, showLoadingIndicator]);

  useIsomorphicLayoutEffect(() => {
    if (!loaded || showFallback || !shouldAnimateRevealRef.current) {
      return;
    }

    const backdrop = loadingBackdropRef.current;
    const image = imageRef.current;
    const options: KeyframeAnimationOptions = {
      duration: 500,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    };
    const animations: Animation[] = [];

    if (typeof backdrop?.animate === 'function') {
      animations.push(
        backdrop.animate([{ opacity: 1 }, { opacity: 0 }], options),
      );
    }
    if (typeof image?.animate === 'function') {
      animations.push(image.animate([{ opacity: 0 }, { opacity: 1 }], options));
    }
    if (
      typeof image?.animate === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      // 轻微回缩只在动画期间生效，结束后不残留变换
      animations.push(
        image.animate(
          [{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
          {
            duration: 900,
            easing: options.easing,
            fill: 'backwards',
          },
        ),
      );
    }

    return () => animations.forEach((animation) => animation.cancel());
  }, [loaded, processed, showFallback]);

  const recordDoubanRoute = useCallback(
    (succeeded: boolean) => {
      if (!candidate?.doubanRoute) return;
      recordDoubanRouteResult(
        'image',
        candidates.map((item) => item.doubanRoute ?? ''),
        candidates[0]?.doubanRoute ?? '',
        Math.min(attempt, candidates.length - 1),
        succeeded,
      );
    },
    [attempt, candidate, candidates],
  );

  const handleLoad = useCallback(() => {
    recordDoubanRoute(true);
    if (candidate?.sourceDirectFallback) rememberSourceCoverDirectHost(src);
    setLoaded(true);
    markCoverImagesLoaded(cacheKeys);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [cacheKeys, candidate, recordDoubanRoute, src]);

  const failLoad = useCallback(
    (persistFailure: boolean) => {
      recordDoubanRoute(false);
      if (attempt < candidates.length - 1) {
        setLoaded(false);
        setHasError(false);
        setAttempt(attempt + 1);
        return;
      }

      // 超时只说明这次没等到，不记入失败缓存，下次挂载仍会重试。
      // 记下全部候选，重新挂载时首个候选即命中失败缓存
      if (persistFailure) {
        markCoverImagesFailed(candidates.map((item) => item.url));
      }
      setHasError(true);
      setLoaded(true);
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
      onUnavailableRef.current?.();
    },
    [attempt, candidates, recordDoubanRoute],
  );
  const handleError = useCallback(() => failLoad(true), [failLoad]);
  const loadTimeoutMs =
    candidate?.doubanRoute && candidate.doubanRoute !== 'server'
      ? DOUBAN_MIRROR_TIMEOUT_MS
      : runtimeConfig.IMAGE_PROXY_TIMEOUT_SECONDS * 1000 +
        COVER_LOAD_TIMEOUT_GRACE_MS;

  useEffect(() => {
    if (!slotGranted || loaded || hasError) return;

    const image = imageRef.current;
    if (!image) return;

    let cancelled = false;

    const finishFromImageState = () => {
      if (cancelled || !image.complete) return false;
      if (image.naturalWidth > 0) {
        handleLoad();
      } else {
        handleError();
      }
      return true;
    };

    if (finishFromImageState()) {
      return;
    }

    queueMicrotask(finishFromImageState);

    if (typeof image.decode === 'function') {
      void image
        .decode()
        .then(finishFromImageState)
        .catch(finishFromImageState);
    }

    const timeoutId = setTimeout(() => {
      if (!finishFromImageState()) failLoad(false);
    }, loadTimeoutMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    failLoad,
    handleError,
    handleLoad,
    hasError,
    loaded,
    loadTimeoutMs,
    processed,
    slotGranted,
  ]);

  if (showFallback) {
    return (
      <NoImageCover label={fallbackLabel} iconSize={34} iconStrokeWidth={1.5} />
    );
  }

  return (
    <div
      ref={containerRef}
      className='absolute inset-0 overflow-hidden rounded-[inherit]'
    >
      <ImageLoadingBackdrop
        ref={loadingBackdropRef}
        active={!revealed && showLoadingIndicator}
        data-cover-loading-backdrop
        data-cover-state={revealed ? 'revealed' : 'loading'}
        className={`pointer-events-none absolute inset-0 z-[100] rounded-lg ${
          revealed ? 'opacity-0' : 'opacity-100'
        }`}
      />
      {slotGranted && (
        <Image
          key={processed}
          ref={imageRef}
          src={processed}
          alt={alt}
          fill
          loader={usesCoverVariants ? buildCoverImageVariantUrl : undefined}
          sizes={sizes}
          quality={needsUnoptimized ? undefined : quality}
          preload={priority}
          fetchPriority={priority ? 'high' : undefined}
          unoptimized={needsUnoptimized}
          className={`${fit === 'contain' ? 'object-contain' : 'object-cover'} ${revealed ? 'opacity-100' : 'opacity-0'}`}
          referrerPolicy='no-referrer'
          loading='eager'
          decoding={knownCached ? 'sync' : 'async'}
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
