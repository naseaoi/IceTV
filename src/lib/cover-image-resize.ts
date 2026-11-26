import 'server-only';

import { createAsyncSemaphore } from '@/lib/async-semaphore';
import {
  COVER_IMAGE_QUALITIES,
  COVER_IMAGE_WIDTHS,
  DEFAULT_COVER_IMAGE_QUALITY,
} from '@/lib/cover-image-variants';
import { ResponseSizeLimitError } from '@/lib/proxy-response-limits';
import { ResourceLimitError } from '@/lib/server-resource-errors';

const MAX_COVER_IMAGE_PIXELS = 25_000_000;
export const MAX_COVER_IMAGE_BYTES = 10 * 1024 * 1024;
const SOURCE_BYTE_BUDGET = 64 * 1024 * 1024;
// 下载前按单图上限预留，完成后缩减为实际字节；覆盖下载、排队和转码。
let reservedSourceBytes = 0;
let activeImageTasks = 0;
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

export async function downloadAndResizeCoverImage(
  download: () => Promise<ArrayBuffer>,
  options: CoverImageResizeOptions,
): Promise<ArrayBuffer> {
  if (
    activeImageTasks >= RESIZE_CONCURRENCY + RESIZE_MAX_WAITING ||
    reservedSourceBytes + MAX_COVER_IMAGE_BYTES > SOURCE_BYTE_BUDGET
  ) {
    throw new ResourceLimitError(503, 2);
  }
  activeImageTasks += 1;
  let reservation = MAX_COVER_IMAGE_BYTES;
  reservedSourceBytes += reservation;
  try {
    const source = await download();
    if (source.byteLength > MAX_COVER_IMAGE_BYTES) {
      throw new ResponseSizeLimitError(MAX_COVER_IMAGE_BYTES);
    }
    reservedSourceBytes -= reservation - source.byteLength;
    reservation = source.byteLength;
    return await resizeCoverImage(source, options);
  } finally {
    reservedSourceBytes -= reservation;
    activeImageTasks -= 1;
  }
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
