'use client';

import { Dices } from 'lucide-react';

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
      className='flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 transition-colors hover:border-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400'
    >
      <Dices className='h-4 w-4' />
    </button>
  );
}
