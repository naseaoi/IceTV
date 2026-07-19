'use client';

import { useEffect, useState } from 'react';

interface ErrorInfo {
  id: string;
  message: string;
  timestamp: number;
}

export function GlobalErrorIndicator() {
  const [currentError, setCurrentError] = useState<ErrorInfo | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);

  useEffect(() => {
    const handleError = (event: CustomEvent) => {
      const { message } = event.detail;
      const newError: ErrorInfo = {
        id: Date.now().toString(),
        message,
        timestamp: Date.now(),
      };

      if (currentError) {
        setCurrentError(newError);
        setIsReplacing(true);

        // 动画完成后恢复正常
        setTimeout(() => {
          setIsReplacing(false);
        }, 200);
      } else {
        setCurrentError(newError);
      }

      setIsVisible(true);
    };

    window.addEventListener('globalError', handleError as EventListener);

    return () => {
      window.removeEventListener('globalError', handleError as EventListener);
    };
  }, [currentError]);

  const handleClose = () => {
    setIsVisible(false);
    setCurrentError(null);
    setIsReplacing(false);
  };

  useEffect(() => {
    if (!currentError) return;
    const timer = window.setTimeout(() => {
      setIsVisible(false);
      setCurrentError(null);
      setIsReplacing(false);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [currentError]);

  if (!isVisible || !currentError) {
    return null;
  }

  return (
    <div className='fixed right-4 top-4 z-[2000]'>
      <div
        className={`flex w-fit max-w-[min(400px,calc(100vw-2rem))] items-center justify-between rounded-lg bg-red-500 px-4 py-3 text-white shadow-lg transition-all duration-300 ${
          isReplacing ? 'scale-105 bg-red-400' : 'scale-100 bg-red-500'
        } animate-fade-in`}
      >
        <span className='mr-3 flex-1 text-sm font-medium'>
          {currentError.message}
        </span>
        <button
          onClick={handleClose}
          className='flex-shrink-0 text-white transition-colors hover:text-red-100'
          aria-label='关闭错误提示'
        >
          <svg
            className='h-5 w-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M6 18L18 6M6 6l12 12'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
