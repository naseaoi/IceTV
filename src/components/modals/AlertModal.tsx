'use client';

import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';

import {
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { type AlertType } from '@/hooks/useAlertModal';

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: AlertType;
  title: string;
  message?: string;
  children?: ReactNode;
  timer?: number;
  showConfirm?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
}

export default function AlertModal({
  isOpen,
  onClose,
  type,
  title,
  message,
  children,
  timer,
  showConfirm = false,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
}: AlertModalProps) {
  useEffect(() => {
    if (!isOpen || !timer) {
      return;
    }

    const timeout = window.setTimeout(() => {
      onClose();
    }, timer);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isOpen, timer, onClose]);

  const toneClassName =
    type === 'success'
      ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300'
      : type === 'error'
        ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300'
        : 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300';

  const icon =
    type === 'success' ? (
      <CheckCircle className='h-5 w-5' />
    ) : type === 'error' ? (
      <AlertCircle className='h-5 w-5' />
    ) : (
      <AlertTriangle className='h-5 w-5' />
    );

  const shouldShowSingleCloseButton = showConfirm && !onConfirm;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} panelClassName='max-w-sm'>
      <div className='p-5 sm:p-6'>
        <div className='flex items-start gap-3'>
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClassName}`}
          >
            {icon}
          </span>
          <div className='min-w-0 pt-1.5'>
            <h3 className={MODAL_TITLE_CLASS}>{title}</h3>
            {message && (
              <p className='mt-1.5 text-sm leading-6 text-gray-500 dark:text-gray-400'>
                {message}
              </p>
            )}
          </div>
        </div>

        {children && (
          <div className='mt-4 rounded-xl bg-gray-900/[0.04] p-3 text-sm leading-6 text-gray-700 dark:bg-white/[0.05] dark:text-gray-200'>
            {children}
          </div>
        )}

        {(shouldShowSingleCloseButton || (showConfirm && onConfirm)) && (
          <div className='mt-6 flex justify-end gap-2'>
            {showConfirm && onConfirm && (
              <button
                onClick={onClose}
                className={MODAL_SECONDARY_BUTTON_CLASS}
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={() => {
                if (onConfirm) {
                  onConfirm();
                }
                onClose();
              }}
              className={MODAL_PRIMARY_BUTTON_CLASS}
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
