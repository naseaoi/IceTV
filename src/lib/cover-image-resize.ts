import 'server-only';

import { createAsyncSemaphore } from '@/lib/async-semaphore';
import {
  COVER_IMAGE_QUALITIES,
  COVER_IMAGE_WIDTHS,
  DEFAULT_COVER_IMAGE_QUALITY,
} from '@/lib/cover-image-variants';

const MAX_COVER_IMAGE_PIXELS = 40_000_000;
// 排队任务各持有一份原图，等待者需有上限；下载阶段已受回源连接预算约束
const RESIZE_CONCURRENCY = 4;
const RESIZE_MAX_WAITING = 16;
const RESIZE_WAIT_TIMEOUT_MS = 10_000;
const resizeGate = createAsyncSemaphore(RESIZE_CONCURRENCY);

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
  const release = await resizeGate.acquire({
    maxWaiting: RESIZE_MAX_WAITING,
    waitTimeoutMs: RESIZE_WAIT_TIMEOUT_MS,
  });
  try {
    return await transcodeCoverImage(source, options);
  } finally {
    release();
  }
}

async function transcodeCoverImage(
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
