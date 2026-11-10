'use client';

import { createContext, useContext } from 'react';

import type { FavoriteWatchStatus } from '@/lib/types';

// 打开作品记录面板所需的作品信息；目录作品的 source 为 douban / bangumi，id 为条目 ID
export interface WatchRecordTarget {
  source: string;
  id: string;
  title: string;
  year?: string;
  cover: string;
  sourceName: string;
  totalEpisodes?: number;
  searchTitle?: string;
  doubanId?: number;
  origin?: 'vod' | 'live';
  feedback?: { watchStateVisible?: boolean; favoriteVisible?: boolean };
}

export const WATCH_STATUS_OPTIONS: {
  value: FavoriteWatchStatus;
  label: string;
}[] = [
  { value: 'planned', label: '想看' },
  { value: 'watching', label: '在看' },
  { value: 'completed', label: '看过' },
];

export const WatchRecordContext = createContext<
  ((target: WatchRecordTarget) => void) | null
>(null);

// 面板 Provider 未挂载时返回 null，调用方据此隐藏入口
export function useOpenWatchRecord() {
  return useContext(WatchRecordContext);
}
