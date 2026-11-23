'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import Select from '@/components/Select';
import Spinner from '@/components/Spinner';
import AdminDialog from '@/features/admin/components/AdminDialog';
import type { LinuxDoCredentialsDraft } from '@/features/admin/hooks/useAdminUserActions';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { copyTextToClipboard } from '@/lib/clipboard';
import { getErrorMessage } from '@/lib/user-facing-error';
import type { LinuxDoLoginSettings, LinuxDoTrustLevel } from '@/types/admin';

export interface LinuxDoSettingsDraft {
  credentials: LinuxDoCredentialsDraft;
  minTrustLevel: LinuxDoTrustLevel;
}

const LINUXDO_CONNECT_URL = 'https://connect.linux.do';
const LINUXDO_CALLBACK_PATH = '/api/auth/linuxdo/callback';
const COPIED_FEEDBACK_MS = 1500;

const LINUXDO_TRUST_LEVEL_OPTIONS = [
  { value: '0', label: '0 级 · 新用户' },
  { value: '1', label: '1 级 · 基本用户' },
  { value: '2', label: '2 级 · 成员' },
  { value: '3', label: '3 级 · 活跃用户' },
  { value: '4', label: '4 级 · 领导者' },
];

const LABEL_CLASS =
  'mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300';
const INPUT_CLASS = `w-full font-mono ${inputStyles.withFocus}`;

function defaultCallbackUri() {
  return typeof window === 'undefined'
    ? ''
    : `${window.location.origin}${LINUXDO_CALLBACK_PATH}`;
}

function LinuxDoSettingsForm({
  configured,
  settings,
  onSave,
  onClose,
}: {
  configured: boolean;
  settings: LinuxDoLoginSettings;
  onSave: (draft: LinuxDoSettingsDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [clientId, setClientId] = useState(settings.ClientId);
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(
    () => settings.RedirectUri || defaultCallbackUri(),
  );
  const [minTrustLevel, setMinTrustLevel] = useState(settings.MinTrustLevel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copyRedirectUri = async () => {
    if (!(await copyTextToClipboard(redirectUri.trim()))) {
      showError(null, '复制失败，请重试');
      return;
    }
    window.clearTimeout(copiedTimer.current);
    setCopied(true);
    copiedTimer.current = window.setTimeout(
      () => setCopied(false),
      COPIED_FEEDBACK_MS,
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const credentials = {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      redirectUri: redirectUri.trim(),
    };
    if (!credentials.clientId) return setError('请填写 Client ID');
    if (!configured && !credentials.clientSecret)
      return setError('请填写 Client Secret');
    if (!credentials.redirectUri) return setError('请填写回调地址');
    setSaving(true);
    setError('');
    try {
      await onSave({ credentials, minTrustLevel });
      onClose();
    } catch (saveError) {
      setError(getErrorMessage(saveError, '保存 LinuxDo 设置失败'));
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit} className='space-y-4'>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='min-w-0'>
          <label htmlFor='linuxdo-client-id' className={LABEL_CLASS}>
            Client ID
          </label>
          <input
            id='linuxdo-client-id'
            type='text'
            autoComplete='off'
            spellCheck={false}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div className='min-w-0'>
          <label htmlFor='linuxdo-client-secret' className={LABEL_CLASS}>
            Client Secret
          </label>
          <input
            id='linuxdo-client-secret'
            type='password'
            autoComplete='new-password'
            spellCheck={false}
            placeholder={configured ? '已保存，留空不修改' : undefined}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            className={`${INPUT_CLASS} placeholder:font-sans`}
          />
        </div>
      </div>
      <div className='min-w-0'>
        <label htmlFor='linuxdo-redirect-uri' className={LABEL_CLASS}>
          回调地址
        </label>
        <div className='relative'>
          <input
            id='linuxdo-redirect-uri'
            type='url'
            autoComplete='off'
            spellCheck={false}
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            className={`${INPUT_CLASS} pr-10`}
          />
          <button
            type='button'
            onClick={() => void copyRedirectUri()}
            aria-label='复制回调地址'
            title={copied ? '已复制' : '复制回调地址'}
            className='absolute inset-y-0 right-1 my-auto flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200'
          >
            {copied ? (
              <Check className='h-4 w-4 text-brand-500' />
            ) : (
              <Copy className='h-4 w-4' />
            )}
          </button>
        </div>
      </div>
      <div className='flex items-center justify-between gap-4'>
        <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
          最低信任等级
        </p>
        <Select
          value={String(minTrustLevel)}
          onChange={(value) =>
            setMinTrustLevel(Number(value) as LinuxDoTrustLevel)
          }
          ariaLabel='LinuxDo 最低信任等级'
          variant='pill'
          align='end'
          options={LINUXDO_TRUST_LEVEL_OPTIONS}
        />
      </div>

      {error && (
        <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
          {error}
        </p>
      )}

      <div className='flex items-center justify-between gap-3 pt-2'>
        <a
          href={LINUXDO_CONNECT_URL}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-400'
        >
          LinuxDo Connect
          <ExternalLink className='h-3 w-3' />
        </a>
        <div className='flex items-center gap-3'>
          <button
            type='button'
            onClick={onClose}
            className={buttonStyles.outline}
          >
            取消
          </button>
          <button
            type='submit'
            disabled={saving}
            className={`${buttonStyles.primary} inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {saving && <Spinner className='h-4 w-4' />}
            保存
          </button>
        </div>
      </div>
    </form>
  );
}

export function LinuxDoSettingsDialog({
  isOpen,
  configured,
  settings,
  onSave,
  onClose,
}: {
  isOpen: boolean;
  configured: boolean;
  settings: LinuxDoLoginSettings;
  // 失败时抛出，由表单就地展示
  onSave: (draft: LinuxDoSettingsDraft) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <AdminDialog
      isOpen={isOpen}
      title='LinuxDo 登录'
      onClose={onClose}
      panelClassName='max-w-xl max-h-[85vh] overflow-y-auto'
    >
      <LinuxDoSettingsForm
        configured={configured}
        settings={settings}
        onSave={onSave}
        onClose={onClose}
      />
    </AdminDialog>
  );
}
