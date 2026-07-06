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

import NoImageCover from '@/components/NoImageCover';
import {
  isCoverImageCached,
  markCoverImagesLoaded,
  subscribeCoverImageLoaded,
} from '@/lib/cover-image-cache';
import { imageScheduler } from '@/lib/image-scheduler';
import { processImageUrl } from '@/lib/utils';

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

const VIEWPORT_PRELOAD_MARGIN = '600px';

interface CoverImageProps {
  src: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
  quality?: number;
  fit?: 'cover' | 'contain';
  aspectRatio?: string;
  placeholderColor?: string;
  fallbackLabel?: string;
}

const CoverImage: React.FC<CoverImageProps> = memo(function CoverImage({
  src,
  alt,
  priority = false,
  sizes = '(max-width: 640px) 96px, 180px',
  quality = 72,
  fit = 'cover',
  placeholderColor,
  fallbackLabel = '无封面',
}) {
  const isEmpty = !src || src.trim() === '';
  const releaseSlotRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const processed = useMemo(
    () => (isEmpty ? '' : processImageUrl(src)),
    [src, isEmpty],
  );

  const needsUnoptimized = useMemo(() => {
    if (!processed) return false;
    return needsImageUnoptimized(processed);
  }, [processed]);

  const cacheKeys = useMemo(
    () => Array.from(new Set([src, processed].filter(Boolean))),
    [processed, src],
  );

  const loadImmediately = !isEmpty && priority;
  const [isNearViewport, setIsNearViewport] = useState(loadImmediately);
  const [loaded, setLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [slotGranted, setSlotGranted] = useState(loadImmediately);

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

  useIsomorphicLayoutEffect(() => {
    setHasError(false);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [src]);

  useIsomorphicLayoutEffect(() => {
    if (isEmpty) return;

    const isCached = isCoverImageCached(cacheKeys);
    setLoaded(isCached);
    setSlotGranted(isCached || priority);
    setIsNearViewport(isCached || priority);

    if (isCached) {
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
      { rootMargin: VIEWPORT_PRELOAD_MARGIN },
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

  const handleLoad = useCallback(() => {
    setLoaded(true);
    markCoverImagesLoaded(cacheKeys);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, [cacheKeys]);

  useEffect(() => {
    if (!slotGranted || loaded || hasError) return;
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      handleLoad();
    }
  }, [handleLoad, hasError, loaded, processed, slotGranted]);

  const handleError = useCallback(() => {
    setHasError(true);
    setLoaded(true);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, []);

  if (showFallback) {
    return (
      <NoImageCover label={fallbackLabel} iconSize={34} iconStrokeWidth={1.5} />
    );
  }

  return (
    <div ref={containerRef} className='absolute inset-0'>
      {!loaded && (
        <div
          className='pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-lg'
          style={loadingBackdropStyle}
        >
          <div className='via-white/8 absolute inset-0 animate-shimmer bg-gradient-to-r from-white/0 to-white/0 dark:from-white/0 dark:via-white/5 dark:to-white/0' />
        </div>
      )}
      {slotGranted && (
        <Image
          key={processed}
          ref={imageRef}
          src={processed}
          alt={alt}
          fill
          sizes={sizes}
          quality={needsUnoptimized ? undefined : quality}
          preload={priority}
          fetchPriority={priority ? 'high' : undefined}
          unoptimized={needsUnoptimized}
          placeholder='blur'
          blurDataURL={blurDataURL}
          className={`${fit === 'contain' ? 'object-contain' : 'object-cover'} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          referrerPolicy='no-referrer'
          loading={priority || loaded ? 'eager' : 'lazy'}
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
