import 'server-only';

import {
  COVER_IMAGE_QUALITIES,
  COVER_IMAGE_WIDTHS,
  DEFAULT_COVER_IMAGE_QUALITY,
} from '@/lib/cover-image-variants';

const MAX_COVER_IMAGE_PIXELS = 40_000_000;

export interface CoverImageResizeOptions {
  width: number;
  quality: number;
}

export class CoverImageResizeParamError extends Error {
  constructor() {
    super('Invalid image resize parameters');
    this.name = 'CoverImageResizeParamError';
  }
}

export function parseCoverImageResizeOptions(
  searchParams: URLSearchParams,
): CoverImageResizeOptions | null {
  const rawWidth = searchParams.get('width');
  if (!rawWidth) {
    return null;
  }

  const width = Number.parseInt(rawWidth, 10);
  const rawQuality = searchParams.get('quality');
  const quality = rawQuality
    ? Number.parseInt(rawQuality, 10)
    : DEFAULT_COVER_IMAGE_QUALITY;

  if (
    String(width) !== rawWidth ||
    !COVER_IMAGE_WIDTHS.includes(
      width as (typeof COVER_IMAGE_WIDTHS)[number],
    ) ||
    (rawQuality !== null && String(quality) !== rawQuality) ||
    !COVER_IMAGE_QUALITIES.includes(
      quality as (typeof COVER_IMAGE_QUALITIES)[number],
    )
  ) {
    throw new CoverImageResizeParamError();
  }

  return { width, quality };
}

export async function resizeCoverImage(
  source: ArrayBuffer,
  options: CoverImageResizeOptions,
): Promise<ArrayBuffer> {
  const { default: sharp } = await import('sharp');
  const output = await sharp(Buffer.from(source), {
    animated: false,
    failOn: 'warning',
    limitInputPixels: MAX_COVER_IMAGE_PIXELS,
  })
    .rotate()
    .resize({
      width: options.width,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: options.quality, smartSubsample: true })
    .toBuffer();

  return Uint8Array.from(output).buffer;
}
