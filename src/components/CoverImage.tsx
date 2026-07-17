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

const VIEWPORT_PRELOAD_MARGIN = '600px';

interface CoverImageProps {
  src: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
  quality?: number;
  fit?: 'cover' | 'contain';
  aspectRatio?: string;
  fallbackLabel?: string;
}

const CoverImage: React.FC<CoverImageProps> = memo(function CoverImage({
  src,
  alt,
  priority = false,
  sizes = '(max-width: 640px) 96px, 180px',
  quality = 72,
  fit = 'cover',
  fallbackLabel = '无封面',
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

  const loadImmediately = !isEmpty && priority;
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
    setKnownCached(isCached);
    setLoaded(false);
    setSlotGranted(isCached || priority);
    setIsNearViewport(isCached || priority);

    if (isCached) {
      shouldAnimateRevealRef.current = false;
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
    }
  }, [cacheKeys, isEmpty, priority]);

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
      { root: document.body, rootMargin: VIEWPORT_PRELOAD_MARGIN },
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
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

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

    if (typeof image.decode === 'function') {
      void image
        .decode()
        .then(finishFromImageState)
        .catch(finishFromImageState);
    }

    intervalId = setInterval(() => {
      if (finishFromImageState() && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }, 250);

    timeoutId = setTimeout(() => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }, 8000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
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
        active={!loaded}
        data-cover-loading-backdrop
        data-cover-state={loaded ? 'revealed' : 'loading'}
        className={`pointer-events-none absolute inset-0 z-[100] rounded-lg ${
          loaded ? 'opacity-0' : 'opacity-100'
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
          className={`${fit === 'contain' ? 'object-contain' : 'object-cover'} ${loaded ? 'opacity-100' : 'opacity-0'}`}
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
