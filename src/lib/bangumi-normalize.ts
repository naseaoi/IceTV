import type { BangumiCalendarData } from './bangumi';
import { toBangumiCoverProxyUrl } from './bangumi-cover-url';

export function selectBangumiCardCover(
  images: BangumiCalendarData['items'][number]['images'],
): string {
  const optimizedLargeCover = toBangumiCoverProxyUrl(images.large);

  return (
    optimizedLargeCover ||
    images.large ||
    images.common ||
    images.medium ||
    images.small ||
    images.grid
  );
}

export function normalizeBangumiCalendarData(
  data: unknown,
): BangumiCalendarData[] {
  if (!Array.isArray(data)) {
    throw new Error('Bangumi 日历格式异常');
  }

  return data.map((item) => {
    const record = readRecord(item);
    const items = record.items;

    return {
      weekday: {
        en: readString(readRecord(record.weekday), 'en'),
      },
      items: Array.isArray(items)
        ? items.map(normalizeBangumiItem).filter(isPresent)
        : [],
    };
  });
}

function normalizeBangumiItem(
  item: unknown,
): BangumiCalendarData['items'][number] | null {
  const record = readRecord(item);
  const images = normalizeBangumiImages(record.images);
  const id = readNumber(record, 'id');
  const name = readString(record, 'name');
  const nameCn = readString(record, 'name_cn');

  if (!images || !Number.isFinite(id) || (!name && !nameCn)) {
    return null;
  }

  return {
    id,
    name,
    name_cn: nameCn,
    rating: {
      score: readNumber(readRecord(record.rating), 'score') || 0,
    },
    air_date: readString(record, 'air_date'),
    images,
  };
}

function normalizeBangumiImages(
  images: unknown,
): BangumiCalendarData['items'][number]['images'] | null {
  const record = readRecord(images);
  const normalizedImages = {
    large: readString(record, 'large'),
    common: readString(record, 'common'),
    medium: readString(record, 'medium'),
    small: readString(record, 'small'),
    grid: readString(record, 'grid'),
  };

  return Object.values(normalizedImages).some(Boolean)
    ? normalizedImages
    : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  return typeof value === 'string' ? value : '';
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Number(value);

    return Number.isFinite(parsedValue) ? parsedValue : Number.NaN;
  }

  return Number.NaN;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
