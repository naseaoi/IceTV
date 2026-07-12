export const COVER_IMAGE_WIDTHS = [
  48, 64, 96, 128, 180, 256, 320, 384, 640, 750, 828, 1080,
] as const;

export const COVER_IMAGE_QUALITIES = [60, 72, 75] as const;

export const DEFAULT_COVER_IMAGE_QUALITY = 72;

const DOUBAN_POSTER_SIZE_RE = /\/view\/photo\/[sml]_ratio_poster\//i;

interface CoverImageLoaderProps {
  src: string;
  width: number;
  quality?: number;
}

export function buildCoverImageVariantUrl({
  src,
  width,
  quality = DEFAULT_COVER_IMAGE_QUALITY,
}: CoverImageLoaderProps): string {
  if (DOUBAN_POSTER_SIZE_RE.test(src)) {
    const size = width <= 270 ? 's' : width <= 540 ? 'm' : 'l';
    return src.replace(
      DOUBAN_POSTER_SIZE_RE,
      `/view/photo/${size}_ratio_poster/`,
    );
  }

  const url = new URL(src, 'http://cover-image.local');
  url.searchParams.set('width', String(width));
  url.searchParams.set('quality', String(quality));
  return `${url.pathname}${url.search}`;
}

export function supportsCoverImageVariants(src: string): boolean {
  return src.startsWith('/api/image-proxy?') || DOUBAN_POSTER_SIZE_RE.test(src);
}
