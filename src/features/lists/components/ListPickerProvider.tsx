'use client';

import { type ReactNode, useCallback, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  type ListPickerTarget,
  ListPickerContext,
} from '@/components/list-picker-context';

import { ListPickerModal } from './ListPickerModal';

export function ListPickerProvider({ children }: { children: ReactNode }) {
  const { session } = useAuthSession();
  const [target, setTarget] = useState<ListPickerTarget | null>(null);
  const close = useCallback(() => setTarget(null), []);

  return (
    <ListPickerContext.Provider
      value={session.status === 'authenticated' ? setTarget : null}
    >
      {children}
      <ListPickerModal target={target} onClose={close} />
    </ListPickerContext.Provider>
  );
}
