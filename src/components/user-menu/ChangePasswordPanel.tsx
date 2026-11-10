'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_LABEL_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell, { useDeferredClose } from '@/components/modals/ModalShell';
import { PasswordInput } from '@/components/PasswordInput';

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
  const [open, requestClose] = useDeferredClose(onClose);
  return (
    <ModalShell
      isOpen={open}
      onClose={requestClose}
      panelClassName='max-w-sm overflow-hidden'
    >
      <ChangePasswordForm onClose={requestClose} onLogout={onLogout} />
    </ModalShell>
  );
}

function ChangePasswordForm({ onClose, onLogout }: ChangePasswordPanelProps) {
  const { session } = useAuthSession();
  const username = session.status === 'authenticated' ? session.username : '';
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/change-password', { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || typeof data.hasPassword !== 'boolean')
          throw new Error('password status');
        setHasPassword(data.hasPassword);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setPasswordError('读取密码状态失败，请重新打开');
      });
    return () => controller.abort();
  }, []);

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

  const handleSubmit = async () => {
    setPasswordError('');

    if (hasPassword === null) return;
    if (hasPassword && !oldPassword) {
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
        role='dialog'
        aria-modal='true'
        aria-labelledby='change-password-title'
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
              {hasPassword === false ? '设置密码' : '修改密码'}
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
            <div>
              <label
                htmlFor='change-password-username'
                className={MODAL_LABEL_CLASS}
              >
                用户名
              </label>
              <input
                id='change-password-username'
                type='text'
                autoComplete='username'
                readOnly
                value={username}
                className={MODAL_INPUT_CLASS}
              />
            </div>
            {PASSWORD_FIELDS.filter(
              (field) => field.key !== 'old' || hasPassword !== false,
            ).map((field) => (
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
                  disabled={passwordLoading || hasPassword === null}
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
                hasPassword === null ||
                (hasPassword && !oldPassword) ||
                !newPassword ||
                !confirmPassword
              }
            >
              {passwordLoading
                ? '保存中…'
                : hasPassword === false
                  ? '设置并重新登录'
                  : '修改并重新登录'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
