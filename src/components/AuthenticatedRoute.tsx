'use client';

import { LockKeyhole, RefreshCw, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import LoadingStatePanel from '@/components/LoadingStatePanel';
import {
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
} from '@/components/modals/modal-styles';
import PageLayout, { type MobileHeaderConfig } from '@/components/PageLayout';
import { ProfileForm } from '@/components/user-menu/ProfilePanel';
import { AuthSessionRole } from '@/lib/auth-session';

interface AuthenticatedRouteProps {
  children: ReactNode;
  activePath: string;
  message: string;
  contentMode?: 'default' | 'player';
  showDesktopBack?: boolean;
  mobileHeader?: MobileHeaderConfig;
  requiredRole?: AuthSessionRole;
  forbiddenMessage?: string;
}

const ROLE_LEVEL: Record<AuthSessionRole, number> = {
  user: 1,
  admin: 2,
  owner: 3,
};

export default function AuthenticatedRoute({
  children,
  activePath,
  message,
  contentMode = 'default',
  showDesktopBack,
  mobileHeader,
  requiredRole = 'user',
  forbiddenMessage = '当前账号没有访问该页面的权限。',
}: AuthenticatedRouteProps) {
  const { session, isRefreshing, refreshSession } = useAuthSession();

  const isAuthenticated = session.status === 'authenticated';
  const isForbidden =
    isAuthenticated && ROLE_LEVEL[session.role] < ROLE_LEVEL[requiredRole];

  if (isAuthenticated && !isForbidden) {
    if (session.nickname === null) {
      return (
        <PageLayout
          activePath={activePath}
          contentMode={contentMode}
          showDesktopBack={showDesktopBack}
          mobileHeader={mobileHeader}
        >
          <div className='mx-auto my-16 w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-white/10'>
            <ProfileForm required />
          </div>
        </PageLayout>
      );
    }
    return children;
  }

  const redirectPath =
    typeof window === 'undefined'
      ? activePath
      : `${window.location.pathname}${window.location.search}`;
  const isError = session.status === 'error';
  const isBlocked = !isRefreshing && (isError || isForbidden);

  return (
    <PageLayout
      activePath={activePath}
      contentMode={contentMode}
      showDesktopBack={showDesktopBack}
      mobileHeader={mobileHeader}
    >
      <div className='flex min-h-[calc(100dvh-6.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-1 items-center justify-center px-4 py-12 md:min-h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))]'>
        <LoadingStatePanel
          icon={isBlocked ? <ShieldAlert /> : <LockKeyhole />}
          iconKey={isBlocked ? 'blocked' : 'lock'}
          loading={isRefreshing}
          tone={isBlocked ? 'red' : 'neutral'}
          title={
            isRefreshing
              ? '正在重新验证登录状态'
              : isForbidden
                ? '权限不足'
                : isError
                  ? '无法验证登录状态'
                  : '需要登录'
          }
          message={
            isRefreshing
              ? ''
              : isForbidden
                ? forbiddenMessage
                : isError
                  ? '请检查网络后重新验证。'
                  : message
          }
        >
          {!isRefreshing && (
            <div className='flex items-center justify-center gap-3'>
              {isForbidden ? null : isError ? (
                <button
                  type='button'
                  onClick={() => void refreshSession()}
                  className={`gap-1.5 ${MODAL_PRIMARY_BUTTON_CLASS}`}
                >
                  <RefreshCw className='h-4 w-4' />
                  重新验证
                </button>
              ) : (
                <Link
                  href={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                  className={MODAL_PRIMARY_BUTTON_CLASS}
                >
                  前往登录
                </Link>
              )}
              <Link href='/' className={MODAL_SECONDARY_BUTTON_CLASS}>
                返回首页
              </Link>
            </div>
          )}
        </LoadingStatePanel>
      </div>
    </PageLayout>
  );
}
