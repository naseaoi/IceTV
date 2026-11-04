'use client';

import { X } from 'lucide-react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { PasswordInput } from '@/components/PasswordInput';
import { RandomPasswordButton } from '@/features/admin/components/RandomPasswordButton';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';

interface ChangePasswordFormProps {
  username: string;
  password: string;
  isOpen: boolean;
  onPasswordChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function ChangePasswordForm({
  username,
  password,
  isOpen,
  onPasswordChange,
  onSubmit,
  onCancel,
  isSubmitting,
}: ChangePasswordFormProps) {
  const disabled = !password || isSubmitting;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      panelClassName='max-w-md max-h-[80vh] overflow-y-auto'
    >
      <div className='space-y-4 p-4 sm:p-6'>
        <div className='flex items-start justify-between gap-3'>
          <h5 className={MODAL_TITLE_CLASS}>修改用户密码</h5>
          <button
            onClick={onCancel}
            aria-label='关闭'
            className={MODAL_CLOSE_BUTTON_CLASS}
          >
            <X className='h-5 w-5' />
          </button>
        </div>
        <div className='space-y-3'>
          <input
            type='text'
            placeholder='用户名'
            value={username}
            disabled
            className={`w-full ${inputStyles.withFocus}`}
          />
          <div className='flex items-center gap-2'>
            <PasswordInput
              placeholder='新密码'
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              wrapperClassName='min-w-0 flex-1'
              className={`w-full pr-10 ${inputStyles.withFocus}`}
            />
            <RandomPasswordButton onGenerate={onPasswordChange} />
          </div>
        </div>
        <div className='flex justify-end space-x-2'>
          <button onClick={onCancel} className={buttonStyles.outline}>
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled}
            className={`${buttonStyles.primary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isSubmitting ? '修改中...' : '修改密码'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
