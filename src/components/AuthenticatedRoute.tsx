'use client';

import { Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';

import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';
import {
  ClientAuthSession,
  getClientAuthSession,
} from '@/lib/auth-session.client';

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
  const [session, setSession] = useState<ClientAuthSession | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getClientAuthSession().then((result) => {
      if (!cancelled) {
        setSession(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (session?.status === 'authenticated') {
    return children;
  }

  const redirectPath =
    typeof window === 'undefined'
      ? activePath
      : `${window.location.pathname}${window.location.search}`;
  const isError = session?.status === 'error';

  return (
    <PageLayout
      activePath={activePath}
      contentMode={contentMode}
      showDesktopBack={showDesktopBack}
    >
      <div className='flex min-h-[60vh] flex-1 items-center justify-center px-4 py-12'>
        <LoadingStatePanel
          icon={
            session ? (
              <LockKeyhole className='h-10 w-10' />
            ) : (
              <Loader2 className='h-10 w-10 animate-spin' />
            )
          }
          tone={isError ? 'red' : 'amber'}
          title={
            session
              ? isError
                ? '无法验证登录状态'
                : '需要登录'
              : '正在验证登录状态'
          }
          message={
            session ? (isError ? '请检查网络后重新验证。' : message) : ''
          }
        >
          {session && (
            <div className='flex items-center justify-center gap-3'>
              {isError ? (
                <button
                  type='button'
                  onClick={() => {
                    setSession(null);
                    setAttempt((current) => current + 1);
                  }}
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
