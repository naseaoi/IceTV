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
import { imageScheduler } from '@/lib/image-scheduler';
import {
  isSourceCoverProxyUrl,
  markSourceCoverProxyHostFailed,
} from '@/lib/source-cover-proxy';
import { processImageUrl } from '@/lib/utils';

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
}) {
  const isEmpty = !src || src.trim() === '';
  const releaseSlotRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingBackdropRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const shouldAnimateRevealRef = useRef(true);
  const runtimeConfig = useRuntimeConfig();
  const [useDirectFallback, setUseDirectFallback] = useState(false);

  const processed = useMemo(
    () =>
      isEmpty
        ? ''
        : useDirectFallback
          ? src
          : processImageUrl(src, runtimeConfig.SOURCE_COVER_PROXY_MODE),
    [isEmpty, runtimeConfig.SOURCE_COVER_PROXY_MODE, src, useDirectFallback],
  );

  const usesCoverVariants = supportsCoverImageVariants(processed);
  const needsUnoptimized = useMemo(
    () => needsImageUnoptimized(processed, usesCoverVariants),
    [processed, usesCoverVariants],
  );

  const cacheKeys = useMemo(
    () => Array.from(new Set([src, processed].filter(Boolean))),
    [processed, src],
  );
  const loadImmediately = !isEmpty && priority && !checkClientCacheBeforeLoad;
  const [isNearViewport, setIsNearViewport] = useState(loadImmediately);
  const [loaded, setLoaded] = useState(false);
  const [knownCached, setKnownCached] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [slotGranted, setSlotGranted] = useState(loadImmediately);

  useIsomorphicLayoutEffect(() => {
    shouldAnimateRevealRef.current = true;
    setHasError(false);
    setUseDirectFallback(false);
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
  }, [cacheKeys, isEmpty, priority, processed]);

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

    return () => animations.forEach((animation) => animation.cancel());
  }, [loaded, processed, showFallback]);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    markCoverImagesLoaded(cacheKeys);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [cacheKeys]);

  const handleError = useCallback(() => {
    if (
      runtimeConfig.SOURCE_COVER_PROXY_MODE === 'auto' &&
      isSourceCoverProxyUrl(processed) &&
      !useDirectFallback
    ) {
      markSourceCoverProxyHostFailed(src);
      setLoaded(false);
      setHasError(false);
      setUseDirectFallback(true);
      return;
    }

    markCoverImagesFailed([processed]);
    setHasError(true);
    setLoaded(true);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [
    processed,
    runtimeConfig.SOURCE_COVER_PROXY_MODE,
    src,
    useDirectFallback,
  ]);

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
      if (!finishFromImageState()) handleError();
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [handleError, handleLoad, hasError, loaded, processed, slotGranted]);

  if (showFallback) {
    return (
      <NoImageCover label={fallbackLabel} iconSize={34} iconStrokeWidth={1.5} />
    );
  }

  return (
    <div ref={containerRef} className='absolute inset-0'>
      <ImageLoadingBackdrop
        ref={loadingBackdropRef}
        active={!revealed}
        data-cover-loading-backdrop
        data-cover-state={revealed ? 'revealed' : 'loading'}
        className={`pointer-events-none absolute inset-0 z-[100] rounded-lg ${
          revealed ? 'opacity-0' : 'cover-loading-backdrop-pending'
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
          loading={priority || knownCached || loaded ? 'eager' : 'lazy'}
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
