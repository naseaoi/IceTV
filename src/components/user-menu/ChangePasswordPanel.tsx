'use client';

import { X } from 'lucide-react';
import { useState } from 'react';

import { PasswordInput } from '@/components/PasswordInput';

import { useBodyScrollLock } from './useBodyScrollLock';

interface ChangePasswordPanelProps {
  onClose: () => void;
  onLogout: () => Promise<void>;
}

export function ChangePasswordPanel({
  onClose,
  onLogout,
}: ChangePasswordPanelProps) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  useBodyScrollLock(true);

  const handleSubmit = async () => {
    setPasswordError('');

    if (!oldPassword) {
      setPasswordError('请输入当前密码');
      return;
    }

    if (!newPassword) {
      setPasswordError('新密码不得为空');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          oldPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPasswordError(data.error || '修改密码失败');
        return;
      }

      onClose();
      await onLogout();
    } catch {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <>
      <div
        className='fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        onTouchMove={(event) => event.preventDefault()}
        onWheel={(event) => event.preventDefault()}
        style={{
          touchAction: 'none',
        }}
      />

      <div className='fixed left-1/2 top-1/2 z-[1001] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10'>
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(event) => event.stopPropagation()}
          style={{
            touchAction: 'auto',
          }}
        >
          <div className='mb-6 flex items-center justify-between'>
            <div>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                修改密码
              </h3>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                修改密码后需要重新登录
              </p>
            </div>
            <button
              onClick={onClose}
              className='flex h-8 w-8 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
              aria-label='Close'
            >
              <X className='h-full w-full' />
            </button>
          </div>

          <div className='space-y-4'>
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                当前密码
              </label>
              <PasswordInput
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400'
                placeholder='请输入当前密码'
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                disabled={passwordLoading}
              />
            </div>

            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                新密码
              </label>
              <PasswordInput
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400'
                placeholder='请输入新密码'
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={passwordLoading}
              />
            </div>

            <div>
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                确认密码
              </label>
              <PasswordInput
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400'
                placeholder='请再次输入新密码'
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {passwordError && (
              <div className='rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-500 dark:border-red-800 dark:bg-red-900/20'>
                {passwordError}
              </div>
            )}
          </div>

          <div className='mt-6 flex gap-3'>
            <button
              onClick={onClose}
              className='flex-1 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              disabled={passwordLoading}
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              className='flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-green-700 dark:hover:bg-green-600'
              disabled={
                passwordLoading ||
                !oldPassword ||
                !newPassword ||
                !confirmPassword
              }
            >
              {passwordLoading ? '修改中...' : '确认修改'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
