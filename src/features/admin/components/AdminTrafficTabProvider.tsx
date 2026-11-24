'use client';

import { createContext, ReactNode, useContext } from 'react';

const TrafficTabVisibleContext = createContext(false);

// 是否显示「流量」页由服务端按统计文件与额度判断，见 isTrafficTabVisible()
export function AdminTrafficTabProvider({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <TrafficTabVisibleContext.Provider value={visible}>
      {children}
    </TrafficTabVisibleContext.Provider>
  );
}

export function useTrafficTabVisible(): boolean {
  return useContext(TrafficTabVisibleContext);
}
