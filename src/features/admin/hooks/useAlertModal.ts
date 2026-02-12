'use client';

import { useCallback, useState } from 'react';

export type AlertType = 'success' | 'error' | 'warning';

export interface AlertModalState {
  isOpen: boolean;
  type: AlertType;
  title: string;
  message?: string;
  timer?: number;
  showConfirm?: boolean;
}

export type ShowAlertFn = (config: Omit<AlertModalState, 'isOpen'>) => void;

export function useAlertModal() {
  const [alertModal, setAlertModal] = useState<AlertModalState>({
    isOpen: false,
    type: 'success',
    title: '',
  });

  const showAlert = useCallback<ShowAlertFn>((config) => {
    setAlertModal({ ...config, isOpen: true });
  }, []);

  const hideAlert = useCallback(() => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return { alertModal, showAlert, hideAlert };
}
