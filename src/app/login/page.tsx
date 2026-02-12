/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

// 版本显示组件
function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (_) {
        // do nothing
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  return (
    <button
      onClick={() =>
        window.open('https://github.com/MoonTechLab/IceTV', '_blank')
      }
      className='absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 transition-colors cursor-pointer'
    >
      <span className='font-mono'>v{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED && (
        <div
          className={`flex items-center gap-1.5 ${
            updateStatus === UpdateStatus.HAS_UPDATE
              ? 'text-yellow-600 dark:text-yellow-400'
              : updateStatus === UpdateStatus.NO_UPDATE
                ? 'text-green-600 dark:text-green-400'
                : ''
          }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <>
              <AlertCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>有新版本</span>
            </>
          )}
          {updateStatus === UpdateStatus.NO_UPDATE && (
            <>
              <CheckCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>已是最新</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [registerEnabled, setRegisterEnabled] = useState(false);

  const { siteName } = useSite();

  // 在客户端挂载后设置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
      setRegisterEnabled(
        storageType &&
          storageType !== 'localstorage' &&
          !!(window as any).RUNTIME_CONFIG?.OPEN_REGISTER,
      );
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!password || (shouldAskUsername && !username)) return;

    if (mode === 'register') {
      if (!registerEnabled) {
        setError('当前未开放注册');
        return;
      }
      if (!confirmPassword) {
        setError('请再次输入密码');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
    }

    try {
      setLoading(true);
      const endpoint = mode === 'register' ? '/api/register' : '/api/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok && mode === 'login') {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.ok && mode === 'register') {
        setSuccess('注册成功，请使用新账号登录');
        setMode('login');
        setPassword('');
        setConfirmPassword('');
      } else if (res.status === 401) {
        setError('密码错误');
      } else if (res.status === 403) {
        setError(mode === 'register' ? '当前未开放注册' : '无访问权限');
      } else if (res.status === 409) {
        setError('用户名已存在');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden'>
      <div className='absolute top-4 right-4'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40 backdrop-blur-xl shadow-2xl p-10 dark:border dark:border-zinc-800'>
        <h1 className='text-green-600 tracking-tight text-center text-3xl font-extrabold mb-8 bg-clip-text drop-shadow-sm'>
          {siteName}
        </h1>
        {registerEnabled && (
          <div className='mb-6 grid grid-cols-2 rounded-xl bg-gray-100/80 dark:bg-zinc-800/70 p-1'>
            <button
              type='button'
              onClick={() => {
                setMode('login');
                setError(null);
                setSuccess(null);
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-white dark:bg-zinc-700 text-green-600 dark:text-green-400 shadow'
                  : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              登录
            </button>
            <button
              type='button'
              onClick={() => {
                setMode('register');
                setError(null);
                setSuccess(null);
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-white dark:bg-zinc-700 text-green-600 dark:text-green-400 shadow'
                  : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              注册
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className='space-y-8'>
          {shouldAskUsername && (
            <div>
              <label htmlFor='username' className='sr-only'>
                用户名
              </label>
              <input
                id='username'
                type='text'
                autoComplete='username'
                className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
                placeholder='输入用户名'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}

          <div className='relative'>
            <label htmlFor='password' className='sr-only'>
              密码
            </label>
            <input
              id='password'
              type={showPassword ? 'text' : 'password'}
              autoComplete={
                mode === 'register' ? 'new-password' : 'current-password'
              }
              className='block w-full rounded-lg border-0 py-3 pl-4 pr-12 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
              placeholder={mode === 'register' ? '输入密码' : '输入访问密码'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type='button'
              onClick={() => setShowPassword((prev) => !prev)}
              className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? (
                <EyeOff className='w-5 h-5' />
              ) : (
                <Eye className='w-5 h-5' />
              )}
            </button>
          </div>

          {mode === 'register' && (
            <div className='relative'>
              <label htmlFor='confirm-password' className='sr-only'>
                确认密码
              </label>
              <input
                id='confirm-password'
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete='new-password'
                className='block w-full rounded-lg border-0 py-3 pl-4 pr-12 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
                placeholder='再次输入密码'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                type='button'
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                aria-label={
                  showConfirmPassword ? '隐藏确认密码' : '显示确认密码'
                }
              >
                {showConfirmPassword ? (
                  <EyeOff className='w-5 h-5' />
                ) : (
                  <Eye className='w-5 h-5' />
                )}
              </button>
            </div>
          )}

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}
          {success && (
            <p className='text-sm text-green-600 dark:text-green-400'>
              {success}
            </p>
          )}

          <button
            type='submit'
            disabled={
              !password ||
              loading ||
              (shouldAskUsername && !username) ||
              (mode === 'register' && !confirmPassword)
            }
            className='inline-flex w-full justify-center rounded-lg bg-green-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:from-green-600 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {loading
              ? mode === 'register'
                ? '注册中...'
                : '登录中...'
              : mode === 'register'
                ? '注册'
                : '登录'}
          </button>
        </form>
      </div>

      {/* 版本信息显示 */}
      <VersionDisplay />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
