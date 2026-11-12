'use client';

import { useState } from 'react';

import { LinuxDoIcon } from '@/components/LinuxDoIcon';
import { MODAL_LABEL_CLASS } from '@/components/modals/modal-styles';
import Spinner from '@/components/Spinner';
import { getLinuxDoErrorMessage } from '@/lib/linuxdo-errors';

import {
  inputClass,
  PRIMARY_SUBMIT_CLASS,
  SWITCH_LINK_CLASS,
} from './lib/login-form-styles';

export function LinuxDoInviteForm({
  providerUsername,
  onError,
  onCancel,
}: {
  providerUsername: string;
  onError: (message: string | null) => void;
  onCancel: () => void;
}) {
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const trimmed = inviteCode.trim();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || loading) return;
    onError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/linuxdo/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        window.location.href =
          typeof data.redirect === 'string' ? data.redirect : '/';
        return;
      }
      onError(
        data.error ||
          (typeof data.code === 'string'
            ? getLinuxDoErrorMessage(data.code)
            : undefined) ||
          '注册失败，请稍后重试',
      );
    } catch {
      onError('网络错误，请稍后重试');
    }
    setLoading(false);
  };

  return (
    <>
      <form onSubmit={handleSubmit} className='space-y-4'>
        <div className='flex items-center gap-3 rounded-lg bg-gray-900/[0.04] px-3.5 py-3 dark:bg-white/[0.06]'>
          <LinuxDoIcon className='h-8 w-8 shrink-0' />
          <div className='min-w-0'>
            <p className='text-xs text-gray-500 dark:text-gray-400'>
              LinuxDo 账号
            </p>
            <p className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
              {providerUsername}
            </p>
          </div>
        </div>
        <div>
          <label htmlFor='linuxdo-invite-code' className={MODAL_LABEL_CLASS}>
            邀请码
          </label>
          <input
            id='linuxdo-invite-code'
            type='text'
            autoComplete='off'
            autoCapitalize='characters'
            autoFocus
            className={inputClass()}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />
        </div>
        <button
          type='submit'
          disabled={!trimmed || loading}
          className={PRIMARY_SUBMIT_CLASS}
        >
          {loading && <Spinner className='h-4 w-4' />}
          {loading ? '注册中...' : '注册并登录'}
        </button>
      </form>
      <p className='mt-6 text-center text-sm text-gray-500 dark:text-gray-400'>
        已有账号？
        <button type='button' onClick={onCancel} className={SWITCH_LINK_CLASS}>
          去登录
        </button>
      </p>
    </>
  );
}
