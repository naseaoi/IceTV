'use client';

import { createContext, useContext } from 'react';

import type { WatchRecordTarget } from '@/components/watch-record-context';

export type ListPickerTarget = Pick<
  WatchRecordTarget,
  'source' | 'id' | 'title' | 'year' | 'cover' | 'searchTitle'
>;

export const ListPickerContext = createContext<
  ((target: ListPickerTarget) => void) | null
>(null);

// 未登录或 Provider 未挂载时返回 null，调用方据此隐藏入口
export function useOpenListPicker() {
  return useContext(ListPickerContext);
}
