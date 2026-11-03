'use client';

import { X } from 'lucide-react';
import { useState } from 'react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_LABEL_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import { PasswordInput } from '@/components/PasswordInput';

import { useBodyScrollLock } from './useBodyScrollLock';

interface ChangePasswordPanelProps {
  onClose: () => void;
  onLogout: () => Promise<void>;
}

const PASSWORD_FIELDS = [
  {
    key: 'old',
    id: 'change-password-old',
    label: '当前密码',
    autoComplete: 'current-password',
  },
  {
    key: 'new',
    id: 'change-password-new',
    label: '新密码',
    autoComplete: 'new-password',
  },
  {
    key: 'confirm',
    id: 'change-password-confirm',
    label: '确认新密码',
    autoComplete: 'new-password',
  },
] as const;

export function ChangePasswordPanel({
  onClose,
  onLogout,
}: ChangePasswordPanelProps) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const passwordValues = {
    old: oldPassword,
    new: newPassword,
    confirm: confirmPassword,
  };
  const passwordSetters = {
    old: setOldPassword,
    new: setNewPassword,
    confirm: setConfirmPassword,
  };

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
        className='fixed inset-0 z-[1000] bg-black/50'
        onClick={onClose}
        onTouchMove={(event) => event.preventDefault()}
        onWheel={(event) => event.preventDefault()}
        style={{
          touchAction: 'none',
        }}
      />

      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='change-password-title'
        className='fixed left-1/2 top-1/2 z-[1001] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/10 ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/50 dark:ring-white/[0.08]'
      >
        <form
          className='p-5 sm:p-6'
          data-panel-content
          onTouchMove={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          <div className='mb-5 flex items-center justify-between gap-3'>
            <h3 id='change-password-title' className={MODAL_TITLE_CLASS}>
              修改密码
            </h3>
            <button
              type='button'
              onClick={onClose}
              className={`${MODAL_CLOSE_BUTTON_CLASS} -mr-1.5`}
              aria-label='关闭'
            >
              <X className='h-4 w-4' />
            </button>
          </div>

          <div className='space-y-4'>
            {PASSWORD_FIELDS.map((field) => (
              <div key={field.id}>
                <label htmlFor={field.id} className={MODAL_LABEL_CLASS}>
                  {field.label}
                </label>
                <PasswordInput
                  id={field.id}
                  autoComplete={field.autoComplete}
                  className={`${MODAL_INPUT_CLASS} pr-10`}
                  value={passwordValues[field.key]}
                  onChange={(event) =>
                    passwordSetters[field.key](event.target.value)
                  }
                  disabled={passwordLoading}
                />
              </div>
            ))}

            {passwordError && (
              <p
                role='alert'
                className='text-sm text-rose-600 dark:text-rose-400'
              >
                {passwordError}
              </p>
            )}
          </div>

          <div className='mt-6 flex justify-end gap-2'>
            <button
              type='button'
              onClick={onClose}
              className={MODAL_SECONDARY_BUTTON_CLASS}
              disabled={passwordLoading}
            >
              取消
            </button>
            <button
              type='submit'
              className={MODAL_PRIMARY_BUTTON_CLASS}
              disabled={
                passwordLoading ||
                !oldPassword ||
                !newPassword ||
                !confirmPassword
              }
            >
              {passwordLoading ? '修改中…' : '修改并重新登录'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
