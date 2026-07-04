import type { DoubanItem } from '@/lib/types';

export interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle?: string;
    pic?: {
      large?: string;
      normal?: string;
    };
    rating?: {
      value?: number;
    };
  }>;
}

export interface DoubanListApiResponse {
  total?: number;
  subjects: Array<{
    id: string;
    title: string;
    card_subtitle?: string;
    cover: string;
    rate: string;
  }>;
}

export interface DoubanRecommendApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    year: string;
    type: string;
    pic?: {
      large?: string;
      normal?: string;
    };
    rating?: {
      value?: number;
    };
  }>;
}

export function normalizeDoubanCategoryItems(
  items: DoubanCategoryApiResponse['items'],
): DoubanItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    poster: item.pic?.normal || item.pic?.large || '',
    rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
    year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
  }));
}

export function normalizeDoubanListSubjects(
  subjects: DoubanListApiResponse['subjects'],
): DoubanItem[] {
  return subjects.map((item) => ({
    id: item.id,
    title: item.title,
    poster: item.cover,
    rate: item.rate,
    year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
  }));
}

export function normalizeDoubanRecommendItems(
  items: DoubanRecommendApiResponse['items'],
): DoubanItem[] {
  return items
    .filter((item) => item.type === 'movie' || item.type === 'tv')
    .map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.year,
    }));
}
