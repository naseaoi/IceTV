'use client';

import { type ReactNode, useCallback, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  type WatchRecordTarget,
  WatchRecordContext,
} from '@/components/watch-record-context';
import { WatchRecordPanel } from '@/features/watch-record/WatchRecordPanel';

export function WatchRecordProvider({ children }: { children: ReactNode }) {
  const { session } = useAuthSession();
  const [target, setTarget] = useState<WatchRecordTarget | null>(null);
  const [open, setOpen] = useState(false);
  // 每次打开都重新挂载面板，读取最新的片单与评价
  const [openCount, setOpenCount] = useState(0);
  const openPanel = useCallback((next: WatchRecordTarget) => {
    setTarget(next);
    setOpenCount((value) => value + 1);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <WatchRecordContext.Provider
      value={session.status === 'authenticated' ? openPanel : null}
    >
      {children}
      {target && (
        <WatchRecordPanel
          key={openCount}
          target={target}
          open={open}
          onClose={close}
        />
      )}
    </WatchRecordContext.Provider>
  );
}
