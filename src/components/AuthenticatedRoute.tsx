'use client';

import { Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';

interface AuthenticatedRouteProps {
  children: ReactNode;
  activePath: string;
  message: string;
  contentMode?: 'default' | 'player';
  showDesktopBack?: boolean;
}

export default function AuthenticatedRoute({
  children,
  activePath,
  message,
  contentMode = 'default',
  showDesktopBack,
}: AuthenticatedRouteProps) {
  const { session, isRefreshing, refreshSession } = useAuthSession();

  if (session.status === 'authenticated') {
    return children;
  }

  const redirectPath =
    typeof window === 'undefined'
      ? activePath
      : `${window.location.pathname}${window.location.search}`;
  const isError = session.status === 'error';

  return (
    <PageLayout
      activePath={activePath}
      contentMode={contentMode}
      showDesktopBack={showDesktopBack}
    >
      <div className='flex min-h-[calc(100dvh-6.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-1 items-center justify-center px-4 py-12 md:min-h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))]'>
        <LoadingStatePanel
          icon={
            isRefreshing ? (
              <Loader2 className='h-10 w-10 animate-spin' />
            ) : (
              <LockKeyhole className='h-10 w-10' />
            )
          }
          tone={isError ? 'red' : 'amber'}
          title={
            isRefreshing
              ? '正在重新验证登录状态'
              : isError
                ? '无法验证登录状态'
                : '需要登录'
          }
          message={
            isRefreshing ? '' : isError ? '请检查网络后重新验证。' : message
          }
        >
          {!isRefreshing && (
            <div className='flex items-center justify-center gap-3'>
              {isError ? (
                <button
                  type='button'
                  onClick={() => void refreshSession()}
                  className='inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700'
                >
                  <RefreshCw className='h-4 w-4' />
                  重新验证
                </button>
              ) : (
                <Link
                  href={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                  className='inline-flex items-center rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700'
                >
                  前往登录
                </Link>
              )}
              <Link
                href='/'
                className='inline-flex items-center rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
              >
                返回首页
              </Link>
            </div>
          )}
        </LoadingStatePanel>
      </div>
    </PageLayout>
  );
}
