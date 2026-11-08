import type { SearchResult } from '@/lib/types';

type SeriesStatus = NonNullable<SearchResult['series_status']>;

export interface SeriesStatusInput {
  vod_remarks?: unknown;
  vod_isend?: unknown;
  vod_serial?: unknown;
  vod_total?: unknown;
  type_name?: unknown;
  episodeCount?: number;
}

export function isSeriesStatus(value: unknown): value is SeriesStatus {
  return value === 'ongoing' || value === 'ended';
}

function finiteNumber(value: unknown): number | undefined {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseSeriesStatus(
  input: SeriesStatusInput,
): SeriesStatus | undefined {
  const remarks =
    typeof input.vod_remarks === 'string' ? input.vod_remarks : '';
  if (/完结|已完|全\s*\d+\s*[集话話期]|全集/.test(remarks)) return 'ended';
  if (/更新至|更至|更新到|连载|第\s*\d+\s*[集话話期]/.test(remarks))
    return 'ongoing';
  if (input.vod_isend === 1 || input.vod_isend === '1') return 'ended';

  const total = finiteNumber(input.vod_total);
  const serial = finiteNumber(input.vod_serial);
  if (
    total !== undefined &&
    total > 0 &&
    serial !== undefined &&
    serial >= total
  ) {
    return 'ended';
  }

  const typeName =
    typeof input.type_name === 'string' ? input.type_name.trim() : '';
  if (
    input.episodeCount === 1 &&
    (/电影|片$/.test(typeName) ||
      /HD|BD|蓝光|正片|高清|TC|TS|抢先/i.test(remarks))
  ) {
    return 'ended';
  }
  return undefined;
}
