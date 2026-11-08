'use client';

import { Dices } from 'lucide-react';

import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { generateRandomPassword } from '@/lib/random-password';

interface RandomPasswordButtonProps {
  onGenerate: (password: string) => void;
  disabled?: boolean;
}

export function RandomPasswordButton({
  onGenerate,
  disabled = false,
}: RandomPasswordButtonProps) {
  return (
    <button
      type='button'
      onClick={() => onGenerate(generateRandomPassword())}
      disabled={disabled}
      title='随机生成密码'
      aria-label='随机生成密码'
      className={`${buttonStyles.outline} flex h-9 w-9 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <Dices className='h-4 w-4 shrink-0' />
    </button>
  );
}
