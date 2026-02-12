'use client';

import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { type AlertType } from '@/features/admin/hooks/useAlertModal';

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: AlertType;
  title: string;
  message?: string;
  timer?: number;
  showConfirm?: boolean;
}

export default function AlertModal({
  isOpen,
  onClose,
  type,
  title,
  message,
  timer,
  showConfirm = false,
}: AlertModalProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
    if (!timer) return;

    const timeout = window.setTimeout(() => {
      onClose();
    }, timer);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isOpen, timer, onClose]);

  if (!isOpen) {
    return null;
  }

  const icon =
    type === 'success' ? (
      <CheckCircle className='w-8 h-8 text-green-500' />
    ) : type === 'error' ? (
      <AlertCircle className='w-8 h-8 text-red-500' />
    ) : (
      <AlertTriangle className='w-8 h-8 text-yellow-500' />
    );

  const bgColor =
    type === 'success'
      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
      : type === 'error'
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
        : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';

  return createPortal(
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full border ${bgColor} transition-all duration-200 ${
          isVisible ? 'scale-100' : 'scale-95'
        }`}
      >
        <div className='p-6 text-center'>
          <div className='flex justify-center mb-4'>{icon}</div>

          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
            {title}
          </h3>

          {message && (
            <p className='text-gray-600 dark:text-gray-400 mb-4'>{message}</p>
          )}

          {showConfirm && (
            <button
              onClick={onClose}
              className='px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
            >
              确定
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
