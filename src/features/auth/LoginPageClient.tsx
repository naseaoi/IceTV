'use client';

import { AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { MODAL_LABEL_CLASS } from '@/components/modals/modal-styles';
import { SiteIcon } from '@/components/SiteIcon';
import { useSite } from '@/components/SiteProvider';
import Spinner from '@/components/Spinner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useNicknameAvailability } from '@/hooks/useNicknameAvailability';
import { getClientAuthRuntimeConfig } from '@/lib/runtime-config';
import { validateNickname } from '@/lib/user-profile';
import { normalizeUsername } from '@/lib/username';

import { useUsernameAvailability } from './hooks/useUsernameAvailability';
import {
  type RegisterField,
  type RegisterFieldErrors,
  validateRegisterForm,
} from './lib/registerValidation';
import { PosterWallBackdrop } from './PosterWallBackdrop';

// 与 MODAL_INPUT_CLASS 同风格；移动端保持 16px 字号，避免 iOS 聚焦时放大页面
const INPUT_BASE_CLASS =
  'block h-11 w-full rounded-lg border-0 bg-gray-900/[0.04] px-3.5 text-base text-gray-900 ring-1 ring-inset transition-colors placeholder:text-gray-400 focus:bg-white focus:ring-2 dark:bg-white/[0.06] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-950 sm:text-sm';

const INPUT_VALID_RING_CLASS =
  'ring-gray-900/[0.08] focus:ring-brand-500 dark:ring-white/[0.08]';

const INPUT_INVALID_RING_CLASS =
  'ring-rose-500/60 focus:ring-rose-500 dark:ring-rose-500/60';

const inputClass = (invalid = false) =>
  `${INPUT_BASE_CLASS} ${
    invalid ? INPUT_INVALID_RING_CLASS : INPUT_VALID_RING_CLASS
  }`;

const FIELD_ERROR_CLASS = 'mt-1.5 text-xs text-rose-600 dark:text-rose-400';

const FIELD_HINT_CLASS = 'mt-1.5 text-xs text-gray-500 dark:text-gray-400';

const FIELD_OK_CLASS = 'mt-1.5 text-xs text-brand-600 dark:text-brand-400';

const PASSWORD_TOGGLE_CLASS =
  'absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300';

const SWITCH_LINK_CLASS =
  'font-medium text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300';

function FormNotice({
  tone,
  children,
}: {
  tone: 'error' | 'success';
  children: ReactNode;
}) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mb-5 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] leading-5 ${
        tone === 'error'
          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
          : 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
      }`}
    >
      <Icon className='mt-0.5 h-4 w-4 shrink-0' />
      <span>{children}</span>
    </div>
  );
}

export function LoginPageClient() {
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
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
  const nicknameAvailability = useNicknameAvailability(nickname, isRegister);

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
      try {
        validateNickname(nickname);
      } catch (error) {
        setError((error as Error).message);
        return;
      }
      if (nicknameAvailability.status !== 'available') {
        setError(nicknameAvailability.message || '请等待昵称检测完成');
        return;
      }
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
          ...(mode === 'register'
            ? { nickname: validateNickname(nickname).nickname }
            : {}),
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
        const data = await res.json().catch(() => ({}));
        setError(data.error || '用户名或昵称已存在');
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
    <div className='flex min-h-[100dvh] flex-col bg-white dark:bg-gray-950 lg:flex-row'>
      <section className='relative isolate h-[40svh] min-h-[260px] shrink-0 overflow-hidden bg-gray-950 lg:h-auto lg:min-h-0 lg:flex-1 [@media(max-height:500px)_and_(max-width:1023px)]:h-36 [@media(max-height:500px)_and_(max-width:1023px)]:min-h-0'>
        <PosterWallBackdrop />
        <div className='absolute inset-0 bg-[radial-gradient(120%_90%_at_30%_40%,transparent_20%,rgba(0,0,0,0.55)_100%)]' />
        <div className='absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/90 via-black/45 to-transparent' />
        <div className='absolute inset-y-0 right-0 hidden w-1/3 bg-gradient-to-r from-transparent to-black/60 lg:block' />
        <Link
          href='/'
          className='absolute bottom-12 left-6 flex items-center gap-3 transition-opacity hover:opacity-80 sm:left-8 lg:bottom-14 lg:left-14 lg:gap-4'
        >
          <span className='h-10 w-10 lg:h-14 lg:w-14'>
            <SiteIcon />
          </span>
          <span className='text-2xl font-semibold tracking-tight text-white lg:text-5xl'>
            {siteName}
          </span>
        </Link>
      </section>

      <div className='relative z-10 -mt-6 flex flex-1 flex-col rounded-t-[28px] bg-white dark:bg-gray-950 dark:ring-1 dark:ring-white/[0.06] lg:mt-0 lg:w-[480px] lg:flex-none lg:rounded-none xl:w-[520px]'>
        <ThemeToggle className='absolute right-4 top-5 flex h-10 w-10 items-center justify-center rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-200 lg:right-6 lg:top-6' />

        <main className='flex flex-1 justify-center px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-7 sm:px-8 lg:items-center lg:px-14 lg:pb-16 lg:pt-16'>
          <div className='w-full max-w-[360px] animate-slide-up'>
            <h1 className='mb-7 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white lg:mb-8 lg:text-[28px]'>
              {isRegister ? '注册账号' : '登录'}
            </h1>

            {error && <FormNotice tone='error'>{error}</FormNotice>}
            {success && <FormNotice tone='success'>{success}</FormNotice>}

            <form onSubmit={handleSubmit} className='space-y-4'>
              {shouldAskUsername && (
                <div>
                  <label htmlFor='username' className={MODAL_LABEL_CLASS}>
                    用户名
                  </label>
                  <input
                    id='username'
                    type='text'
                    autoComplete='username'
                    className={inputClass(usernameInvalid)}
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

              {isRegister && (
                <div>
                  <label htmlFor='nickname' className={MODAL_LABEL_CLASS}>
                    昵称
                  </label>
                  <input
                    id='nickname'
                    autoComplete='nickname'
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    required
                    className={inputClass(
                      nicknameAvailability.status === 'error',
                    )}
                  />
                  {nicknameAvailability.message && (
                    <p
                      className={
                        nicknameAvailability.status === 'error'
                          ? FIELD_ERROR_CLASS
                          : FIELD_HINT_CLASS
                      }
                    >
                      {nicknameAvailability.message}
                    </p>
                  )}
                </div>
              )}
              <div>
                <label htmlFor='password' className={MODAL_LABEL_CLASS}>
                  密码
                </label>
                <div className='relative'>
                  <input
                    id='password'
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      mode === 'register' ? 'new-password' : 'current-password'
                    }
                    className={`${inputClass(!!visibleError('password'))} pr-11`}
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
                    className={PASSWORD_TOGGLE_CLASS}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? (
                      <EyeOff className='h-[18px] w-[18px]' />
                    ) : (
                      <Eye className='h-[18px] w-[18px]' />
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
                  <label
                    htmlFor='confirm-password'
                    className={MODAL_LABEL_CLASS}
                  >
                    确认密码
                  </label>
                  <div className='relative'>
                    <input
                      id='confirm-password'
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete='new-password'
                      className={`${inputClass(
                        !!visibleError('confirmPassword'),
                      )} pr-11`}
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
                      className={PASSWORD_TOGGLE_CLASS}
                      aria-label={
                        showConfirmPassword ? '隐藏确认密码' : '显示确认密码'
                      }
                    >
                      {showConfirmPassword ? (
                        <EyeOff className='h-[18px] w-[18px]' />
                      ) : (
                        <Eye className='h-[18px] w-[18px]' />
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
                  <label htmlFor='invite-code' className={MODAL_LABEL_CLASS}>
                    邀请码
                  </label>
                  <input
                    id='invite-code'
                    type='text'
                    autoComplete='off'
                    autoCapitalize='characters'
                    className={inputClass(!!visibleError('inviteCode'))}
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
                className='!mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-[15px] font-medium text-white transition-colors hover:bg-brand-500 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {loading && <Spinner className='h-4 w-4' />}
                {loading
                  ? mode === 'register'
                    ? '注册中...'
                    : '登录中...'
                  : mode === 'register'
                    ? '注册'
                    : '登录'}
              </button>
            </form>

            {(isRegister || registerEnabled === true) && (
              <p className='mt-6 text-center text-sm text-gray-500 dark:text-gray-400'>
                {isRegister ? '已有账号？' : '还没有账号？'}
                <button
                  type='button'
                  onClick={() => switchMode(isRegister ? 'login' : 'register')}
                  className={SWITCH_LINK_CLASS}
                >
                  {isRegister ? '去登录' : '注册'}
                </button>
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
