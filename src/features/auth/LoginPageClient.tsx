'use client';

import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Home,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { SiteIcon } from '@/components/Sidebar';
import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getClientAuthRuntimeConfig } from '@/lib/runtime-config';
import { getPrimaryRepoUrl } from '@/lib/update-source';
import { normalizeUsername } from '@/lib/username';
import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version-check';

import { useUsernameAvailability } from './hooks/useUsernameAvailability';
import {
  type RegisterField,
  type RegisterFieldErrors,
  validateRegisterForm,
} from './lib/registerValidation';
import { PosterWallBackdrop } from './PosterWallBackdrop';

const INPUT_CLASS =
  'block w-full rounded-lg border-0 bg-gray-100/90 px-4 py-3 text-gray-900 ring-1 ring-gray-200/80 transition-shadow placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-white/[0.07] dark:text-white dark:ring-white/10 dark:placeholder:text-gray-500 sm:text-[15px]';

const INPUT_INVALID_CLASS =
  'ring-red-500/60 focus:ring-red-500 dark:ring-red-500/60 dark:focus:ring-red-500';

const FIELD_ERROR_CLASS = 'mt-1.5 text-xs text-red-600 dark:text-red-400';

const FIELD_HINT_CLASS = 'mt-1.5 text-xs text-gray-500 dark:text-gray-400';

const FIELD_OK_CLASS = 'mt-1.5 text-xs text-green-600 dark:text-green-400';

const SWITCH_LINK_CLASS =
  'font-semibold text-green-600 transition-colors hover:text-green-500 hover:underline dark:text-green-400 dark:hover:text-green-300';

const HEADER_ICON_BUTTON_CLASS =
  'flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 lg:text-gray-600 lg:hover:bg-gray-200/50 dark:lg:text-gray-300 dark:lg:hover:bg-gray-700/50';

function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const repoUrl = getPrimaryRepoUrl();

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch {
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  return (
    <button
      onClick={() => window.open(repoUrl, '_blank')}
      className='flex cursor-pointer items-center gap-2 text-xs text-gray-400 transition-colors lg:text-gray-500 dark:lg:text-gray-400'
    >
      <span className='font-mono'>v{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED && (
        <div
          className={`flex items-center gap-1.5 ${
            updateStatus === UpdateStatus.HAS_UPDATE
              ? 'text-yellow-400'
              : updateStatus === UpdateStatus.NO_UPDATE
                ? 'text-green-400'
                : ''
          }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <>
              <AlertCircle className='h-3.5 w-3.5' />
              <span className='text-xs font-semibold'>有新版本</span>
            </>
          )}
          {updateStatus === UpdateStatus.NO_UPDATE && (
            <>
              <CheckCircle className='h-3.5 w-3.5' />
              <span className='text-xs font-semibold'>已是最新</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

export function LoginPageClient() {
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername] = useState(true);
  const [registerEnabled, setRegisterEnabled] = useState<boolean | null>(null);
  const [inviteCodeRequired, setInviteCodeRequired] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [touched, setTouched] = useState<
    Partial<Record<RegisterField, boolean>>
  >({});

  const { siteName } = useSite();

  useEffect(() => {
    let cancelled = false;

    const loadRuntimeConfig = async () => {
      const { openRegister, requireInviteCode } =
        await getClientAuthRuntimeConfig();
      if (cancelled) {
        return;
      }

      setRegisterEnabled(openRegister);
      setInviteCodeRequired(requireInviteCode);
    };

    loadRuntimeConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const isRegister = mode === 'register';

  const fieldErrors: RegisterFieldErrors = useMemo(() => {
    if (!isRegister) return {};
    return validateRegisterForm({
      username,
      password,
      confirmPassword,
      inviteCode,
      inviteCodeRequired,
    });
  }, [
    isRegister,
    username,
    password,
    confirmPassword,
    inviteCode,
    inviteCodeRequired,
  ]);

  const usernameFormatValid = isRegister && !fieldErrors.username;

  const usernameAvailability = useUsernameAvailability({
    username: normalizeUsername(username),
    enabled: usernameFormatValid && registerEnabled === true,
  });

  const visibleError = (field: RegisterField): string | undefined =>
    touched[field] ? fieldErrors[field] : undefined;

  const markTouched = (field: RegisterField) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const usernameTaken = usernameAvailability.status === 'taken';
  const usernameFormatError = visibleError('username');
  const usernameInvalid = !!usernameFormatError || usernameTaken;

  const usernameHint = ((): { text: string; className: string } | null => {
    if (usernameFormatError) {
      return { text: usernameFormatError, className: FIELD_ERROR_CLASS };
    }
    if (!usernameFormatValid) {
      return null;
    }
    switch (usernameAvailability.status) {
      case 'checking':
        return { text: '正在检测用户名…', className: FIELD_HINT_CLASS };
      case 'available':
        return {
          text: usernameAvailability.message || '该用户名可以使用',
          className: FIELD_OK_CLASS,
        };
      case 'taken':
      case 'error':
        return {
          text: usernameAvailability.message || '用户名检测失败',
          className: FIELD_ERROR_CLASS,
        };
      default:
        return null;
    }
  })();

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError(null);
    setSuccess(null);
    setTouched({});
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!password || (shouldAskUsername && !username)) return;

    if (mode === 'register') {
      if (registerEnabled !== true) {
        setError('当前未开放注册');
        return;
      }
      if (Object.keys(fieldErrors).length > 0) {
        setTouched({
          username: true,
          password: true,
          confirmPassword: true,
          inviteCode: true,
        });
        return;
      }
      if (usernameTaken) {
        setError(usernameAvailability.message || '用户名已被占用');
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
          ...(mode === 'register' && inviteCodeRequired
            ? { inviteCode: inviteCode.trim() }
            : {}),
        }),
      });

      if (res.ok && mode === 'login') {
        const redirect =
          new URLSearchParams(window.location.search).get('redirect') || '/';
        window.location.href = redirect;
      } else if (res.ok && mode === 'register') {
        setSuccess('注册成功，请使用新账号登录');
        setMode('login');
        setPassword('');
        setConfirmPassword('');
        setInviteCode('');
      } else if (res.status === 401) {
        setError('密码错误');
      } else if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error ?? (mode === 'register' ? '当前未开放注册' : '无访问权限'),
        );
      } else if (res.status === 409) {
        setError('用户名已存在');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='relative flex min-h-screen overflow-hidden'>
      <div className='absolute inset-0 lg:relative lg:flex-1'>
        <PosterWallBackdrop />
        <div className='pointer-events-none absolute left-4 top-4 z-10 flex select-none items-center gap-3 sm:left-8 sm:top-5'>
          <div className='h-10 w-10 overflow-hidden rounded-xl bg-white/10 p-1.5 shadow-sm ring-1 ring-white/15 backdrop-blur sm:h-11 sm:w-11'>
            <SiteIcon />
          </div>
          <span className='text-xl font-bold tracking-tight text-white drop-shadow-sm sm:text-2xl'>
            {siteName}
          </span>
        </div>
      </div>

      <div className='relative z-10 flex min-h-screen w-full flex-col px-4 sm:px-8 lg:w-[460px] lg:shrink-0 lg:border-l lg:border-black/5 lg:bg-white lg:px-10 lg:shadow-2xl dark:lg:border-white/10 dark:lg:bg-zinc-950'>
        <header className='flex items-center justify-end gap-1 py-4 sm:py-5'>
          <ThemeToggle className={`${HEADER_ICON_BUTTON_CLASS} p-2.5`} />
          <Link
            href='/'
            aria-label='返回首页'
            title='返回首页'
            className={HEADER_ICON_BUTTON_CLASS}
          >
            <Home className='h-5 w-5' />
          </Link>
        </header>

        <main className='flex flex-1 items-center justify-center py-8'>
          <div className='w-full max-w-[420px] rounded-2xl bg-white/85 p-6 shadow-2xl ring-1 ring-black/5 backdrop-blur-2xl dark:bg-zinc-950/70 dark:ring-white/10 sm:p-10 lg:max-w-none lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0 lg:backdrop-blur-none dark:lg:bg-transparent dark:lg:ring-0'>
            <h1 className='text-2xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-[28px]'>
              {mode === 'register' ? '创建账号' : '登录'}
            </h1>
            <p className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
              {mode === 'register'
                ? `注册 ${siteName} 账号，开启观影之旅`
                : `欢迎回来，登录后继续观影`}
            </p>

            {error && (
              <div className='mt-5 flex items-start gap-2.5 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-500/20 dark:bg-red-500/15 dark:text-red-400'>
                <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className='mt-5 flex items-start gap-2.5 rounded-lg bg-green-500/10 px-3.5 py-2.5 text-sm text-green-600 ring-1 ring-green-500/20 dark:bg-green-500/15 dark:text-green-400'>
                <CheckCircle className='mt-0.5 h-4 w-4 shrink-0' />
                <span>{success}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className='mt-6 space-y-4'>
              {shouldAskUsername && (
                <div>
                  <label htmlFor='username' className='sr-only'>
                    用户名
                  </label>
                  <input
                    id='username'
                    type='text'
                    autoComplete='username'
                    className={`${INPUT_CLASS} ${
                      usernameInvalid ? INPUT_INVALID_CLASS : ''
                    }`}
                    placeholder='输入用户名'
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onBlur={() => markTouched('username')}
                    aria-invalid={usernameInvalid}
                    aria-describedby={
                      usernameHint ? 'username-error' : undefined
                    }
                  />
                  {usernameHint && (
                    <p id='username-error' className={usernameHint.className}>
                      {usernameHint.text}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor='password' className='sr-only'>
                  密码
                </label>
                <div className='relative'>
                  <input
                    id='password'
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      mode === 'register' ? 'new-password' : 'current-password'
                    }
                    className={`${INPUT_CLASS} pr-12 ${
                      visibleError('password') ? INPUT_INVALID_CLASS : ''
                    }`}
                    placeholder='输入密码'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => markTouched('password')}
                    aria-invalid={!!visibleError('password')}
                    aria-describedby={
                      visibleError('password') ? 'password-error' : undefined
                    }
                  />
                  <button
                    type='button'
                    onClick={() => setShowPassword((prev) => !prev)}
                    className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? (
                      <EyeOff className='h-5 w-5' />
                    ) : (
                      <Eye className='h-5 w-5' />
                    )}
                  </button>
                </div>
                {visibleError('password') && (
                  <p id='password-error' className={FIELD_ERROR_CLASS}>
                    {visibleError('password')}
                  </p>
                )}
              </div>

              {mode === 'register' && (
                <div>
                  <label htmlFor='confirm-password' className='sr-only'>
                    确认密码
                  </label>
                  <div className='relative'>
                    <input
                      id='confirm-password'
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete='new-password'
                      className={`${INPUT_CLASS} pr-12 ${
                        visibleError('confirmPassword')
                          ? INPUT_INVALID_CLASS
                          : ''
                      }`}
                      placeholder='再次输入密码'
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onBlur={() => markTouched('confirmPassword')}
                      aria-invalid={!!visibleError('confirmPassword')}
                      aria-describedby={
                        visibleError('confirmPassword')
                          ? 'confirm-password-error'
                          : undefined
                      }
                    />
                    <button
                      type='button'
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                      aria-label={
                        showConfirmPassword ? '隐藏确认密码' : '显示确认密码'
                      }
                    >
                      {showConfirmPassword ? (
                        <EyeOff className='h-5 w-5' />
                      ) : (
                        <Eye className='h-5 w-5' />
                      )}
                    </button>
                  </div>
                  {visibleError('confirmPassword') && (
                    <p
                      id='confirm-password-error'
                      className={FIELD_ERROR_CLASS}
                    >
                      {visibleError('confirmPassword')}
                    </p>
                  )}
                </div>
              )}

              {mode === 'register' && inviteCodeRequired && (
                <div>
                  <label htmlFor='invite-code' className='sr-only'>
                    邀请码
                  </label>
                  <input
                    id='invite-code'
                    type='text'
                    autoComplete='off'
                    autoCapitalize='characters'
                    className={`${INPUT_CLASS} ${
                      visibleError('inviteCode') ? INPUT_INVALID_CLASS : ''
                    }`}
                    placeholder='邀请码'
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    onBlur={() => markTouched('inviteCode')}
                    aria-invalid={!!visibleError('inviteCode')}
                    aria-describedby={
                      visibleError('inviteCode')
                        ? 'invite-code-error'
                        : undefined
                    }
                  />
                  {visibleError('inviteCode') && (
                    <p id='invite-code-error' className={FIELD_ERROR_CLASS}>
                      {visibleError('inviteCode')}
                    </p>
                  )}
                </div>
              )}

              <button
                type='submit'
                disabled={
                  !password ||
                  loading ||
                  (shouldAskUsername && !username) ||
                  (isRegister &&
                    (Object.keys(fieldErrors).length > 0 || usernameTaken))
                }
                className='!mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 py-3 text-base font-semibold text-white shadow-lg shadow-green-600/25 transition-colors hover:bg-green-500 active:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {loading && <Loader2 className='h-4 w-4 animate-spin' />}
                {loading
                  ? mode === 'register'
                    ? '注册中...'
                    : '登录中...'
                  : mode === 'register'
                    ? '注册'
                    : '登录'}
              </button>
            </form>

            <div className='mt-8 min-h-5 text-center text-sm text-gray-500 dark:text-gray-400'>
              {mode === 'login' ? (
                registerEnabled === true ? (
                  <span>
                    还没有账号？{' '}
                    <button
                      type='button'
                      onClick={() => switchMode('register')}
                      className={SWITCH_LINK_CLASS}
                    >
                      立即注册
                    </button>
                  </span>
                ) : registerEnabled === false ? (
                  <span>暂未开放注册</span>
                ) : null
              ) : (
                <span>
                  已有账号？{' '}
                  <button
                    type='button'
                    onClick={() => switchMode('login')}
                    className={SWITCH_LINK_CLASS}
                  >
                    直接登录
                  </button>
                </span>
              )}
            </div>
          </div>
        </main>

        <footer className='flex justify-center pb-4 lg:pb-6'>
          <VersionDisplay />
        </footer>
      </div>
    </div>
  );
}
