'use client';

import { Eye, EyeOff } from 'lucide-react';
import { InputHTMLAttributes, useId, useState } from 'react';

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> & {
  wrapperClassName?: string;
};

export function PasswordInput({
  className = '',
  wrapperClassName = '',
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();

  return (
    <div className={`relative ${wrapperClassName}`.trim()}>
      <input
        {...props}
        id={props.id || inputId}
        type={visible ? 'text' : 'password'}
        className={className}
      />
      <button
        type='button'
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        className='absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
      >
        {visible ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
      </button>
    </div>
  );
}
