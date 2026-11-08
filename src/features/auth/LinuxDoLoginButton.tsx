'use client';

import { useEffect, useState } from 'react';

import { LinuxDoIcon } from '@/components/LinuxDoIcon';
import Spinner from '@/components/Spinner';

export function LinuxDoLoginButton({ redirect }: { redirect: string }) {
  const [pending, setPending] = useState(false);
  const href = `/api/auth/linuxdo?mode=login&redirect=${encodeURIComponent(
    redirect,
  )}`;

  // 从授权页后退时浏览器可能直接恢复缓存页面，需复位跳转中状态
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  return (
    <>
      <div
        className='my-6 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500'
        aria-hidden='true'
      >
        <span className='h-px flex-1 bg-gray-900/[0.08] dark:bg-white/[0.08]' />
        或
        <span className='h-px flex-1 bg-gray-900/[0.08] dark:bg-white/[0.08]' />
      </div>
      <a
        href={href}
        aria-disabled={pending}
        onClick={(event) => {
          if (pending) {
            event.preventDefault();
            return;
          }
          setPending(true);
        }}
        className={`inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-full text-[15px] font-medium text-gray-800 ring-1 ring-inset ring-gray-900/[0.12] transition-colors dark:text-gray-100 dark:ring-white/[0.14] ${
          pending
            ? 'cursor-default bg-gray-900/[0.04] dark:bg-white/[0.06]'
            : 'hover:bg-gray-900/[0.04] active:bg-gray-900/[0.07] dark:hover:bg-white/[0.06] dark:active:bg-white/[0.1]'
        }`}
      >
        {pending ? (
          <Spinner className='h-4 w-4' />
        ) : (
          <LinuxDoIcon className='h-5 w-5' />
        )}
        {pending ? '正在前往 LinuxDo…' : '使用 LinuxDo 登录'}
      </a>
    </>
  );
}
